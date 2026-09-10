import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '#/components/theme-provider'
import { Button } from '#/components/ui/button'
import type { ThemePreference } from '#/lib/theme'
import { cn } from '#/lib/utils'

const OPTIONS: Array<{
  value: ThemePreference
  label: string
  icon: typeof Sun
}> = [
  { value: 'light', label: 'Světlé', icon: Sun },
  { value: 'dark', label: 'Tmavé', icon: Moon },
  { value: 'system', label: 'Systém', icon: Monitor },
]

export function ThemeToggle({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Téma vzhledu"
      className={cn(
        'inline-flex rounded-lg border border-border bg-muted/40 p-1',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon
        const active = theme === opt.value
        return (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={active}
            title={opt.label}
            className={cn(
              'h-8 gap-1.5 px-2.5',
              active &&
                'bg-background text-foreground shadow-sm hover:bg-background',
              !active && 'text-muted-foreground',
            )}
            onClick={() => setTheme(opt.value)}
          >
            <Icon className="h-3.5 w-3.5" />
            {compact ? (
              <span className="sr-only">{opt.label}</span>
            ) : (
              <span className="hidden sm:inline">{opt.label}</span>
            )}
          </Button>
        )
      })}
    </div>
  )
}
