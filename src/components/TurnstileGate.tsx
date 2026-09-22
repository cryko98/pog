import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  /** from /season/config; the widget does not render without it */
  siteKey: string;
  onPassed: () => void;
}

/** Cloudflare's explicit-render API, the parts of it we touch. */
interface Turnstile {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'compact' | 'flexible';
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    }
  ) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT_ID = 'cf-turnstile';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Load Cloudflare's script once per page, and resolve when `window.turnstile`
 * is actually usable — the script tag firing `load` is not the same thing.
 */
let loader: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;

  loader = new Promise<Turnstile>((resolve, reject) => {
    const ready = () => {
      // the global appears a tick after onload in some browsers
      let tries = 0;
      const poll = window.setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          resolve(window.turnstile);
        } else if (++tries > 40) {
          clearInterval(poll);
          reject(new Error('Turnstile loaded but never became available.'));
        }
      }, 50);
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      ready();
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = ready;
    script.onerror = () => reject(new Error('Could not reach the captcha service.'));
    document.head.appendChild(script);
  }).catch((err) => {
    loader = null; // let a later mount try again
    throw err;
  });

  return loader;
}

/**
 * The captcha step of qualifying for Frost — once per wallet per season.
 *
 * Renders only when the server hands over a site key, which it only does
 * when both halves of the Turnstile pair are configured. That is the whole
 * reason the key comes from the API rather than the build: a half-configured
 * captcha would put an unsatisfiable item on the checklist.
 */
export function TurnstileGate({ siteKey, onPassed }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'checking' | 'passed' | 'failed'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!siteKey || !holder.current) return;
    let alive = true;
    let widgetId: string | null = null;
    let api_: Turnstile | null = null;

    loadTurnstile()
      .then((turnstile) => {
        if (!alive || !holder.current) return;
        api_ = turnstile;
        setState('ready');
        widgetId = turnstile.render(holder.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: 'flexible',
          callback: (token) => {
            if (!alive) return;
            setState('checking');
            setError('');
            api
              .verifyHuman(token)
              .then(() => {
                if (!alive) return;
                setState('passed');
                onPassed();
              })
              .catch((err: Error) => {
                if (!alive) return;
                setState('failed');
                setError(err.message);
                if (widgetId && api_) api_.reset(widgetId);
              });
          },
          'error-callback': () => {
            if (alive) setState('failed');
          },
          'expired-callback': () => {
            if (alive) setState('ready');
          },
        });
      })
      .catch((err: Error) => {
        if (!alive) return;
        setState('failed');
        setError(err.message);
      });

    return () => {
      alive = false;
      if (widgetId && api_) {
        try {
          api_.remove(widgetId);
        } catch {
          /* already gone with the node */
        }
      }
    };
    // onPassed is read through the closure on purpose: re-rendering the
    // widget because the parent re-created a callback would drop a
    // challenge the player is halfway through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div className="sn-captcha">
      {state === 'passed' ? (
        <p className="sn-captcha-done">
          <Icon name="check" size={14} /> Verified for this season.
        </p>
      ) : (
        <>
          <div ref={holder} />
          {state === 'loading' && <small>Loading the captcha…</small>}
          {state === 'checking' && <small>Checking…</small>}
          {state === 'failed' && <small className="sn-captcha-error">{error || 'That did not check out.'}</small>}
        </>
      )}
    </div>
  );
}
