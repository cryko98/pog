import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Landing } from './pages/Landing';

// The game pulls in the canvas engine and the MQTT client — several hundred
// kilobytes that the landing page has no use for.
const Play = lazy(() => import('./pages/Play'));

export type Route = 'home' | 'play';

const readRoute = (): Route => (location.hash.replace(/^#\/?/, '') === 'play' ? 'play' : 'home');

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: Route) => {
    location.hash = next === 'play' ? '#/play' : '#/';
  }, []);

  return [route, navigate];
}

export function App() {
  const [route, navigate] = useRoute();

  useEffect(() => {
    document.body.style.overflow = route === 'play' ? 'hidden' : '';
  }, [route]);

  if (route !== 'play') return <Landing navigate={navigate} />;

  return (
    <Suspense
      fallback={
        <div className="game">
          <div className="game-loading">
            <div>
              <div className="spinner" />
              <p>Loading the ice…</p>
            </div>
          </div>
        </div>
      }
    >
      <Play navigate={navigate} />
    </Suspense>
  );
}
