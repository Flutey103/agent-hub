import { Menu } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"
import { productAudience, productDescription, productName, productTagline, productTitle } from "../../../shared/brand"
import { pricingDisclaimer, pricingEyebrow, pricingPlans } from "@/config/pricing"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/dialog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/menu"
import { usePageTitle } from "@/lib/utils"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
]

const FAQ = [
  {
    q: `What is ${productName}?`,
    a: "An operations desk for the assistants you already use. Claude, ChatGPT and Grok pick up tasks, hand work to each other, and run on a schedule. You approve anything that matters from one inbox.",
  },
  {
    q: "Who is it for?",
    a: "Solo operators running more than one business, and small teams of people who already pay for two or more AI assistants. It is a place to coordinate work, not another memory store.",
  },
  {
    q: "How do I connect an assistant?",
    a: "Paste one MCP URL into Claude, ChatGPT or Grok. You land on a consent screen, pick a workspace, name the assistant, and approve. Most people are connected in a minute. API keys stay available for headless use.",
  },
  {
    q: "What does approve mean?",
    a: "A review gate lands in your inbox with the brief, the handoff note and the draft. Approve it, or send it back with what to change. The next stage does not start until you do.",
  },
  {
    q: "Can I use it for more than one business?",
    a: "Yes. Each business is a workspace, with its own agents, tasks and documents. Switch between them from the sidebar.",
  },
  {
    q: "Is this the final price?",
    a: "No. The prices on this page are early access and can change. You are not billed from this site.",
  },
  {
    q: "I was invited and I don't have a password.",
    a: "On the sign-in page, use Email me a sign-in link. If you would rather use a password, choose Forgot password and set one from the email we send.",
  },
]

export default function LandingPage() {
  usePageTitle(productTitle)
  const [menu, setMenu] = useState(false)
  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
          <a href="#top" className="truncate text-sm font-semibold">
            {productName}
          </a>
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="inline-flex h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:text-foreground">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Button variant="ghost" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link to="/signup">Get started</Link>
            </Button>
          </div>
          <Button variant="ghost" className="ml-auto md:hidden" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button size="icon" variant="ghost" className="md:hidden" aria-label="Open menu" onClick={() => setMenu(true)}>
            <Menu />
          </Button>
        </div>
      </header>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{productName}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="flex min-h-11 items-center text-sm" onClick={() => setMenu(false)}>
                {link.label}
              </a>
            ))}
            <Button className="mt-4 w-full" asChild>
              <Link to="/signup">Get started</Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <main id="top">
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-20">
          <p className="text-sm text-muted-foreground">Operations desk for your AI assistants</p>
          <h1 className="mt-3 max-w-3xl text-[2rem] leading-[1.15] font-semibold tracking-tight sm:text-5xl">{productTagline}</h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">{productDescription}</p>
          <p className="mt-2 text-sm text-muted-foreground">{productAudience}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button asChild className="w-full sm:w-auto">
              <Link to="/signup">Get started</Link>
            </Button>
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
          <p className="mt-8 text-xs tracking-wide text-muted-foreground uppercase">Works with Claude, ChatGPT and Grok</p>
          <ProductMock />
        </section>

        <section id="how" className="border-t">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="grid gap-4 md:grid-cols-3">
              {[
                ["Connect in a minute", "Paste one MCP URL into Claude, ChatGPT or Grok and approve the assistant. No key required, unless you want one for a headless run."],
                ["Hand off the work", "A task starts with one assistant and moves to the next with the brief, the documents and a handoff note attached."],
                ["Approve from the inbox", "Review gates land in one place. Approve, or send the work back. Scheduled workflows keep running while you are away."],
              ].map(([title, body], index) => (
                <li key={title} className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">0{index + 1}</div>
                  <h3 className="mt-2 font-medium">{title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="border-t">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight">What you get</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["One inbox", "Approvals and questions, with approve and request-changes on the card."],
                ["Tasks with a lease", "An assistant claims work for a window, then hands it on. Nothing sits in two chats at once."],
                ["Scheduled workflows", "Weekday drafts, Monday research, or anything you run by hand. You can see each run."],
                ["Knowledge", "Versioned documents and short facts the assistants can read without a copy-paste."],
                ["A workspace per business", "Switch from one company to the next without mixing their context."],
                ["An audit trail", "Every tool call is recorded, so you can see what an assistant actually did."],
              ].map(([title, body]) => (
                <article key={title} className="rounded-lg border p-4">
                  <h3 className="font-medium">{title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-20">
            <p className="text-sm text-muted-foreground">{pricingEyebrow}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Simple pricing</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{pricingDisclaimer}</p>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {pricingPlans.map((plan) => (
                <article key={plan.id} className={cn("flex flex-col rounded-lg border p-4", plan.highlighted && "border-foreground")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-medium">{plan.name}</h3>
                    {plan.highlighted ? <span className="text-xs text-muted-foreground">Early access</span> : null}
                  </div>
                  <p className="mt-3 text-3xl font-semibold tracking-tight">
                    {plan.price}
                    <span className="text-base font-normal text-muted-foreground">{plan.cadence}</span>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
                  <ul className="mt-4 flex-1 space-y-2 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <Button asChild className="mt-5 w-full" variant={plan.highlighted ? "default" : "outline"}>
                    <Link to="/signup">{plan.cta}</Link>
                  </Button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="border-t">
          <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
            <Accordion type="single" collapsible className="mt-4">
              {FAQ.map((item) => (
                <AccordionItem key={item.q} value={item.q}>
                  <AccordionTrigger>{item.q}</AccordionTrigger>
                  <AccordionContent>{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium text-foreground">{productName}</div>
            <p className="mt-1 max-w-md">{productTagline}</p>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <Link className="inline-flex min-h-11 items-center" to="/login">
              Sign in
            </Link>
            <Link className="inline-flex min-h-11 items-center" to="/signup">
              Get started
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function ProductMock() {
  return (
    <div className="mt-10 overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="truncate text-xs text-muted-foreground">Inbox · Northwind Studio</span>
        <span className="text-xs text-amber-700 dark:text-amber-300">2 need you</span>
      </div>
      <div className="grid md:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="hidden border-r p-2 text-sm md:block">
          {["Home", "Inbox", "Tasks", "Workflows"].map((item, index) => (
            <div key={item} className={cn("flex h-9 items-center rounded-md px-2", index === 1 && "bg-accent font-medium")}>
              {item}
            </div>
          ))}
        </div>
        <div className="space-y-2 p-3">
          <MockRow title="Approve the weekly briefing" meta="Grok reviewed Claude's draft" />
          <MockRow title="Which price should the launch post use?" meta="Claude asked. You decide." />
        </div>
      </div>
    </div>
  )
}

function MockRow({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">Approve</span>
        <span className="inline-flex h-9 items-center justify-center rounded-md border text-xs">Request changes</span>
      </div>
    </div>
  )
}
