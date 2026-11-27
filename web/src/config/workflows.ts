import type { LoopStage } from "../lib/types"

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  cron: string | null
  stages: LoopStage[]
}

/** Form presets. The Worker uses standard 5-field cron in UTC. */
export const CRON_PRESETS: { id: string; label: string; cron: string | null }[] = [
  { id: "manual", label: "Manual only", cron: null },
  { id: "hourly", label: "Every hour", cron: "0 * * * *" },
  { id: "daily", label: "Every day at 9:00", cron: "0 9 * * *" },
  { id: "weekdays", label: "Weekdays at 9:00", cron: "0 9 * * 1-5" },
  { id: "monday", label: "Mondays at 9:00", cron: "0 9 * * 1" },
]

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "draft-review",
    name: "Draft and review",
    description: "One assistant drafts, a second reviews, and you approve from the inbox.",
    cron: "0 9 * * 1-5",
    stages: [
      {
        name: "Draft",
        brief: "Draft the piece from the notes in this workspace. Write it so a reviewer who was not in the room can follow the argument.",
        capability: "long-form-writing",
      },
      {
        name: "Review",
        brief: "Review the draft for accuracy and tone. Leave a handoff note with what to change, or pass it on if it is ready.",
        capability: "editing",
        review_by: "tone-review",
      },
      {
        name: "Approve",
        brief: "Read the draft and the review note. Approve it, or send it back with what to change.",
        human: true,
      },
    ],
  },
  {
    id: "research-brief",
    name: "Research brief",
    description: "A researcher gathers sources, then you decide what is worth writing.",
    cron: "0 9 * * 1",
    stages: [
      {
        name: "Research",
        brief: "Collect the facts a writer would need. Record each sourced claim, and attach a short brief.",
        capability: "web-research",
      },
      {
        name: "Decide",
        brief: "Read the brief and choose what should be written next.",
        human: true,
      },
    ],
  },
]
