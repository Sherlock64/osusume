import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The frame of the no-login screens. */
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
    <main className="flex min-h-svh items-start justify-center p-4 sm:items-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          {description !== undefined && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children !== undefined && (
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        )}
      </Card>
    </main>
  );
}
