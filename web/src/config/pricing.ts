/**
 * Early-access pricing shown on the marketing site.
 * Change this file to update the public prices. Nothing is billed from the site.
 */
export interface PricingPlan {
  id: string
  name: string
  price: string
  cadence: string
  description: string
  features: string[]
  highlighted?: boolean
  cta: string
}

export const pricingEyebrow = "Early-access pricing"

export const pricingDisclaimer =
  "Early-access pricing. These prices are a starting hypothesis and can change before anyone is billed. Nothing is charged from this page."

export const pricingPlans: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "",
    description: "Try the desk with one business.",
    features: ["1 workspace", "3 agents", "1 workflow", "2,000 tool calls a month", "14-day history"],
    cta: "Get started",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    cadence: "/mo",
    description: "For an operator running several businesses.",
    highlighted: true,
    features: ["5 workspaces", "Unlimited agents", "25 workflows", "50,000 tool calls a month", "1-year history", "API keys"],
    cta: "Get started",
  },
  {
    id: "team",
    name: "Team",
    price: "$19",
    cadence: " per seat",
    description: "A shared inbox for a small team. 3-seat minimum.",
    features: ["Everything in Pro", "Members and roles", "Shared inbox", "Audit export"],
    cta: "Get started",
  },
]
