import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-base transition-colors placeholder:text-muted-foreground hover:border-foreground/60 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-2 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
