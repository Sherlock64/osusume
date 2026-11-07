import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-primary-edge bg-primary text-primary-foreground [a]:hover:bg-primary/85",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-accent",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive [a]:hover:bg-destructive/20",
        success: "border-status-completed/40 bg-status-completed/14 text-status-completed",
        warning: "border-status-plan/40 bg-status-plan/14 text-status-plan",
        outline: "border-foreground/25 text-foreground [a]:hover:bg-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
