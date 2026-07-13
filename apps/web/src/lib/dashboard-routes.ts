export interface DashboardRoute {
  href: string;
  label: string;
}

export function resolveDashboardRoute<T extends DashboardRoute>(
  pathname: string | null,
  routes: readonly T[],
): T | undefined {
  if (!pathname) return undefined;

  return routes
    .filter(
      (route) =>
        pathname === route.href || pathname.startsWith(`${route.href}/`),
    )
    .sort((left, right) => right.href.length - left.href.length)[0];
}
