import { isValidElement } from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Button - flat "Rose" style (Inspired UI).
 *
 * Sizing and radius follow Inspired: h-8 default, rounded-lg.
 *
 * Legacy variants. "clay" and "clay-soft" are kept so existing call sites
 * (and the variant prop type) keep compiling. They no longer render clay:
 *  - `clay`      Rose primary pill with a soft rose shadow (Inspired's CTA).
 *  - `clay-soft` Neutral outlined pill.
 * Prefer "default" / "outline" in new code.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        // Legacy names, flat now (see header comment).
        clay:
          "rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 " +
          "transition-[background-color,box-shadow] duration-200 " +
          "hover:bg-primary/90 " +
          "active:translate-y-px",
        "clay-soft":
          "rounded-full border-border bg-background text-foreground " +
          "transition-[background-color,box-shadow] duration-200 " +
          "hover:bg-muted " +
          "active:translate-y-px",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * Base UI warns in dev whenever `nativeButton` disagrees with what actually renders:
 *   - `nativeButton` true  (the default) but a non-<button> is rendered, e.g.
 *     `<Button render={<Link href="/x" />}>` or `render={<a href="/y" />}`
 *   - `nativeButton` false but a real <button> is rendered.
 *
 * So the default is derived from the `render` prop instead of being hard-wired:
 *   no `render`                  -> native <button>      (true)
 *   `render={<button ... />}`    -> native <button>      (true)
 *   `render={<Link /> | <a />}`  -> link as a button     (false)
 *
 * A `render` that is a function (or a custom component that itself renders a <button>)
 * cannot be inspected here; pass `nativeButton` explicitly in that case.
 */
function rendersNativeButton(render: ButtonPrimitive.Props["render"]): boolean {
  if (render === undefined) return true
  return isValidElement(render) && render.type === "button"
}

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      nativeButton={nativeButton ?? rendersNativeButton(render)}
      {...props}
    />
  )
}

export { Button, buttonVariants }