import * as Dropdown from "@radix-ui/react-dropdown-menu"
import * as SelectPrimitive from "@radix-ui/react-select"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import * as AccordionPrimitive from "@radix-ui/react-accordion"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { Check, ChevronDown } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

export const DropdownMenu = Dropdown.Root
export const DropdownMenuTrigger = Dropdown.Trigger

export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof Dropdown.Content>) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        sideOffset={6}
        className={cn("z-50 min-w-48 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md", className)}
        {...props}
      />
    </Dropdown.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof Dropdown.Item>) {
  return <Dropdown.Item className={cn("flex min-h-11 cursor-pointer items-center rounded-sm px-3 text-sm outline-none select-none data-[highlighted]:bg-accent", className)} {...props} />
}

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={6} className="z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background">
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("grid h-11 w-full grid-cols-2 rounded-md bg-muted p-1 text-sm", className)} {...props} />
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn("inline-flex h-full items-center justify-center rounded-sm px-3 font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground", className)}
      {...props}
    />
  )
}

export const Accordion = AccordionPrimitive.Root

export function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn("border-b", className)} {...props} />
}

export function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header>
      <AccordionPrimitive.Trigger className={cn("group flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium", className)} {...props}>
        {children}
        <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

export function AccordionContent({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content className={cn("pb-3 text-sm text-muted-foreground", className)} {...props} />
}

export const Switch = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof SwitchPrimitive.Root>>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn("inline-flex h-6 w-11 shrink-0 items-center rounded-full border bg-muted data-[state=checked]:bg-primary", className)}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-background transition-transform data-[state=checked]:translate-x-5" />
  </SwitchPrimitive.Root>
))
Switch.displayName = "Switch"

export interface SelectOption {
  value: string
  label: string
  group?: string
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Choose",
  id,
  disabled,
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  id?: string
  disabled?: boolean
}) {
  const groups = new Map<string, SelectOption[]>()
  for (const option of options) {
    const key = option.group ?? ""
    groups.set(key, [...(groups.get(key) ?? []), option])
  }
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger id={id} className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-base md:text-sm">
        <SelectPrimitive.Value placeholder={placeholder} />
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-50 max-h-[min(20rem,70vh)] w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          <SelectPrimitive.Viewport>
            {[...groups.entries()].map(([group, items]) => (
              <SelectPrimitive.Group key={group || "default"}>
                {group ? <SelectPrimitive.Label className="px-3 py-1 text-xs text-muted-foreground">{group}</SelectPrimitive.Label> : null}
                {items.map((option) => (
                  <SelectPrimitive.Item key={option.value} value={option.value} className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-accent">
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
