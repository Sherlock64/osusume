import { createRoute } from '@tanstack/react-router';
import { CanvasPage } from '@/components/canvas/canvas-page';
import { appRoute } from '@/routes/app';

function OwnCanvasPage() {
  const { user } = appRoute.useRouteContext();
  return <CanvasPage username={user.username} editable />;
}

function MemberCanvasPage() {
  const { username } = memberCanvasRoute.useParams();
  const { user } = appRoute.useRouteContext();
  return <CanvasPage username={username} editable={username.toLowerCase() === user.username.toLowerCase()} />;
}

export const ownCanvasRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/constellations',
  component: OwnCanvasPage,
});

export const memberCanvasRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users/$username/constellations',
  component: MemberCanvasPage,
});
