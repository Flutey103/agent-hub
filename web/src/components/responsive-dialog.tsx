import { useIsDesktop } from "@/lib/media"
import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/dialog"

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  const desktop = useIsDesktop()
  const described = description ?? title
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : "sr-only"}>{described}</DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className={description ? undefined : "sr-only"}>{described}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}
