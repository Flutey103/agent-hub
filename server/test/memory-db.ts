type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

function ilike(value: unknown, pattern: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${source}$`, "i").test(String(value ?? ""));
}

function orFilter(expression: string): Filter {
  const terms = expression.split(",").map((term) => {
    const match = /^([a-z_]+)\.(ilike|eq)\.(.*)$/.exec(term);
    if (!match) return () => false;
    const [, column, op, value] = match;
    if (op === "ilike") return (row: Row) => ilike(row[column], value);
    return (row: Row) => row[column] === value;
  });
  return (row) => terms.some((term) => term(row));
}

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private orders: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private returning = false;

  constructor(
    private readonly memory: MemoryDb,
    private readonly table: string,
  ) {}

  select(): this {
    this.returning = true;
    return this;
  }
  insert(row: Row | Row[]): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push((row) => row[column] != null && String(row[column]) <= String(value));
    return this;
  }
  ilike(column: string, pattern: string): this {
    this.filters.push((row) => ilike(row[column], pattern));
    return this;
  }
  or(expression: string): this {
    this.filters.push(orFilter(expression));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }
  maybeSingle(): this {
    this.mode = "maybe";
    return this;
  }
  single(): this {
    this.mode = "single";
    return this;
  }
  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matched(): Row[] {
    let rows = this.memory.rows(this.table).filter((row) => this.filters.every((filter) => filter(row)));
    if (this.orders.length) {
      rows = [...rows].sort((left, right) => {
        for (const order of this.orders) {
          const a = left[order.column] as number | string;
          const b = right[order.column] as number | string;
          if (a === b) continue;
          const compared = a > b ? 1 : -1;
          return order.ascending ? compared : -compared;
        }
        return 0;
      });
    }
    if (this.max != null) rows = rows.slice(0, this.max);
    return rows;
  }

  private finish(rows: Row[]) {
    if (!this.returning && this.op !== "select") return { data: null, error: null };
    if (this.mode === "maybe") {
      if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: rows[0] ?? null, error: null };
    }
    if (this.mode === "single") {
      if (rows.length !== 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  private execute() {
    if (this.op === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const stored = incoming.map((row) => {
        const copy = { ...row };
        if (copy.id == null) copy.id = crypto.randomUUID();
        this.memory.rows(this.table).push(copy);
        return copy;
      });
      return this.finish(stored);
    }
    if (this.op === "update") {
      const rows = this.matched();
      for (const row of rows) Object.assign(row, this.payload);
      return this.finish(rows);
    }
    if (this.op === "delete") {
      const remove = new Set(this.matched());
      this.memory.resetTable(
        this.table,
        this.memory.rows(this.table).filter((row) => !remove.has(row)),
      );
      return { data: null, error: null };
    }
    return this.finish(this.matched());
  }
}

export class MemoryDb {
  private readonly tables = new Map<string, Row[]>();

  rows(table: string): Row[] {
    let found = this.tables.get(table);
    if (!found) {
      found = [];
      this.tables.set(table, found);
    }
    return found;
  }

  resetTable(table: string, rows: Row[]): void {
    this.tables.set(table, rows);
  }

  from(table: string): Query {
    return new Query(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    if (name === "tasks_for_agent") return this.tasksForAgent(String(args.p_agent_id));
    if (name === "claim_task") return this.claimTask(String(args.p_task_id), String(args.p_agent_id));
    if (name === "provision_personal_workspace") return { data: "workspace", error: null };
    return { data: null, error: { message: `unknown rpc ${name}` } };
  }

  private tasksForAgent(agentId: string) {
    const agent = this.rows("agents").find((row) => row.id === agentId);
    if (!agent) return { data: [], error: null };
    const data = this.rows("tasks").filter((task) => task.workspace_id === agent.workspace_id && task.is_human !== true);
    return { data, error: null };
  }

  private claimTask(taskId: string, agentId: string) {
    const agent = this.rows("agents").find((row) => row.id === agentId);
    const task = this.rows("tasks").find((row) => row.id === taskId);
    if (!agent || !task || task.workspace_id !== agent.workspace_id || task.status !== "queued" || task.is_human === true) {
      return { data: null, error: null };
    }
    if (task.assignee_agent_id && task.assignee_agent_id !== agent.id) return { data: null, error: null };
    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
    if (typeof task.assignee_capability === "string" && !capabilities.includes(task.assignee_capability)) return { data: null, error: null };
    task.status = "claimed";
    task.claimed_by = agent.id;
    return { data: { ...task }, error: null };
  }

  client() {
    return {
      from: (table: string) => this.from(table),
      rpc: (name: string, args: Record<string, unknown>) => Promise.resolve(this.rpc(name, args)),
      auth: { getUser: async () => ({ data: { user: null }, error: { message: "no session" } }) },
    };
  }
}
