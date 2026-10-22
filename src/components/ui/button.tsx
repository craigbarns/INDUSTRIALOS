"use client";

import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";

// shadcn/ui's composable Radix Slot + CVA pattern, themed for Industrial OS.
export const buttonVariants = cva("button", {
  variants: {
    variant: {
      primary: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      danger: "button-danger",
    },
  },
  defaultVariants: { variant: "primary" },
});

export function Button({
  children,
  className,
  variant,
  loading,
  disabled,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    asChild?: boolean;
  }) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      data-slot="button"
      className={buttonVariants({ variant, className })}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          )}
          {children}
        </>
      )}
    </Component>
  );
}
