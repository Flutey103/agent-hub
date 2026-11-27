import { productName } from "../../../shared/brand"

export function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
      <div className="space-y-2 text-center">
        <div className="text-sm font-medium">{productName}</div>
        <div className="mx-auto h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse bg-foreground/30" />
        </div>
        <p className="sr-only">Loading</p>
      </div>
    </div>
  )
}
