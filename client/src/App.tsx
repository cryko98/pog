import { useCallback, useEffect, useState } from 'react';
import { Landing } from './pages/Landing';
import { Play } from './pages/Play';

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

  return route === 'play' ? <Play navigate={navigate} /> : <Landing navigate={navigate} />;
}
