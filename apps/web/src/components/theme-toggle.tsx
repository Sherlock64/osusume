import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { nextTheme, readTheme, systemDarkQuery, writeTheme, type ThemeChoice } from '@/lib/theme';

const choices = {
  light: { name: 'Light', Icon: Sun },
  dark: { name: 'Dark', Icon: Moon },
  system: { name: 'System', Icon: Monitor },
};

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    const sync = () => {
      setChoice(readTheme());
      window.osusumeApplyTheme();
    };
    const query = systemDarkQuery();
    query.addEventListener('change', sync);
    window.addEventListener('storage', sync);
    return () => {
      query.removeEventListener('change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const next = () => nextTheme(choice, systemDarkQuery().matches);
  const { name, Icon } = choices[choice ?? 'system'];
  const label = `Theme: ${name}. Switch to ${choices[next() ?? 'system'].name.toLowerCase()}`;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => {
        const chosen = next();
        writeTheme(chosen);
        setChoice(chosen);
        window.osusumeApplyTheme();
      }}
    >
      <Icon />
    </Button>
  );
}
