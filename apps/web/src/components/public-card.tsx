import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ConstellationSky, LogoLockup } from '@/components/logo-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The bar of every logged-out page: the name, and the theme toggle. */
export function PublicBar() {
  return (
    <div className="flex items-center justify-between gap-4">
      <Link to="/" aria-label="Osusume" className="rounded-sm">
        <LogoLockup />
      </Link>
      <ThemeToggle />
    </div>
  );
}

/** The frame of the no-login screens: on wide screens, the logo's sky beside the card. */
export function PublicCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_minmax(28rem,36rem)]">
      <div className="star-field relative hidden items-center justify-center overflow-hidden border-r p-12 lg:flex">
        <ConstellationSky className="text-foreground/50 max-h-[32rem] w-full max-w-[32rem]" />
        <p className="eyebrow absolute bottom-8 left-8">オススメ · a recommendation, in constellations</p>
      </div>
      {/* Phones get the specks without the sky; the card keeps them off the form's text. */}
      <div className="max-lg:star-field flex flex-col gap-8 p-4 sm:p-8">
        <PublicBar />
        <main className="mx-auto my-auto w-full max-w-sm pb-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                <h1>{title}</h1>
              </CardTitle>
              {description !== undefined && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            {children !== undefined && (
              <CardContent className="flex flex-col gap-4">{children}</CardContent>
            )}
          </Card>
        </main>
      </div>
    </div>
  );
}
