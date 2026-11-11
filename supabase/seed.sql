-- Seed: three agents, two shared context artifacts, one weekly social content loop.
-- Headless agents need no API key: the hub calls their provider directly.
-- For connected agents (Claude desktop, ChatGPT connector) run: npm run agent:key -- <slug>

insert into agents (slug, name, provider, model, mode, capabilities, system_prompt) values
  ('grok-research', 'Grok Research', 'xai', 'grok-4', 'headless',
   array['social-search','web-research'],
   'You research social media and the web for recent, relevant articles and conversations in the surgical simulation and medical education industry. Record every finding as a fact with a source URL. Be concrete and cite sources.'),
  ('claude-creative', 'Claude Creative', 'anthropic', 'claude-opus-5-5', 'connected',
   array['design-system','long-form-writing','social-copy'],
   'You write marketing content for Inovus Medical using the brand voice and design system artifacts. Produce finished, publishable copy.'),
  ('chatgpt-editor', 'ChatGPT Editor', 'openai', 'gpt-5', 'headless',
   array['editing','tone-review'],
   'You edit marketing copy for clarity, tone and accuracy against the acceptance criteria. Return the edited copy as a new artifact and list every change you made.');

insert into artifacts (key, version, title, kind, content) values
  ('brand-voice', 1, 'Brand voice', 'markdown',
   '# Brand voice\n\nReplace this with your brand voice guide. Tone, vocabulary to use and avoid, audience, example sentences.'),
  ('design-system-summary', 1, 'Design system summary', 'markdown',
   '# Design system summary\n\nReplace this with a summary of colours, type, logo rules and social templates agents should follow.');

insert into loops (slug, name, description, cron, next_run_at, stages) values
  ('weekly-social-content', 'Weekly social content',
   'Grok finds industry articles, Claude drafts posts from the design system, ChatGPT edits, a human approves.',
   '0 7 * * 1', date_trunc('week', now()) + interval '1 week 7 hours',
   '[
     {"name": "Find industry articles", "capability": "social-search",
      "brief": "Search social media and the web for the 5 most relevant articles or discussions from the last 7 days about surgical simulation, medical education and laparoscopic training. For each, record a fact with the URL, a one-line summary and why it matters to Inovus. Then save a markdown artifact with key weekly-articles listing all five.",
      "acceptance": "Five sources, each with URL, date within 7 days, summary and relevance."},
     {"name": "Draft social posts", "capability": "social-copy",
      "brief": "Using the weekly-articles artifact and the brand-voice and design-system-summary artifacts, draft one LinkedIn post and one X post for each of the three strongest articles. Save them as a markdown artifact with key weekly-social-drafts.",
      "acceptance": "Six posts, on brand, each with a hook, a point of view and a call to action. LinkedIn under 1300 characters, X under 280.",
      "inputs": ["brand-voice", "design-system-summary"]},
     {"name": "Edit for tone and accuracy", "capability": "editing",
      "brief": "Edit the weekly-social-drafts artifact for clarity, tone and factual accuracy against the recorded facts. Save the result as artifact weekly-social-final and list every change in your handoff note.",
      "acceptance": "No factual claim without a matching fact. No post exceeds its character limit."},
     {"name": "Approve and publish", "human": true,
      "brief": "Review weekly-social-final. Approve, or send back with notes by creating a new editing task.",
      "acceptance": "Posts approved and scheduled in HubSpot."}
   ]'::jsonb);
