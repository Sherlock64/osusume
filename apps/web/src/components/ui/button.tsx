import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border text-sm font-medium whitespace-nowrap transition-colors select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-primary-edge bg-primary text-primary-foreground hover:bg-primary/85",
        outline:
          "border-foreground/25 hover:border-foreground/50 hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        ghost:
          "border-transparent hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "border-transparent text-link underline underline-offset-4 hover:decoration-2",
      },
      // Phones get 44px targets; the pointer sizes start at md.
      size: {
        default: "h-11 gap-1.5 px-4 md:h-9 md:px-3",
        xs: "h-8 gap-1 rounded-sm px-2 text-xs md:h-6 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1 rounded-sm px-3 md:h-8 md:px-2.5 md:text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-base md:h-11",
        icon: "size-11 md:size-9",
        "icon-xs": "size-8 rounded-sm md:size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-11 rounded-sm md:size-8",
        "icon-lg": "size-12 md:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
