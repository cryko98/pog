import { PenguinMark } from '../components/PenguinMark';
import { Icon } from '../components/Icon';

/**
 * What the site shows once the project has ended: one page, no game, no
 * wallet, no API. Built in when VITE_POG_CLOSED is set at build time;
 * the server side answers 503 to everything under POG_CLOSED.
 */
export function Closed() {
  return (
    <div className="closed">
      <div className="closed-card">
        <PenguinMark size={96} />
        <h1>The ice has closed.</h1>
        <p>
          POG Frozen World has ended. Thank you to everyone who waddled, chopped, fished, built and
          fought here. Nothing on this site is playable any more, and no token, key or wallet is
          touched by it.
        </p>
        <a className="btn btn-ghost" href="https://x.com/playpogonsol" target="_blank" rel="noreferrer">
          <Icon name="x" size={14} /> @playpogonsol
        </a>
      </div>
    </div>
  );
}
