// backend/src/metrics.ts
// Минимальные внутренние метрики в Prometheus text-формате (GET /metrics).
// Без внешних зависимостей: только счётчики/gauges, которые реально
// используются сервисом.

class Counter {
  private value = 0;

  constructor(
    private readonly name: string,
    private readonly help: string
  ) {}

  inc(by = 1): void {
    this.value += by;
  }

  get(): number {
    return this.value;
  }

  render(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      `${this.name} ${this.value}`,
    ].join("\n");
  }
}

/**
 * Counter с набором меток (Prometheus labels). Метки нужны, чтобы считать
 * запросы по коду ответа; без них гистограмма недоступна, а 5xx не отличить
 * от 2xx.
 */
class LabeledCounter {
  private readonly values = new Map<string, number>();

  constructor(
    private readonly name: string,
    private readonly help: string
  ) {}

  inc(labels: Record<string, string | number>): void {
    const key = Object.entries(labels)
      .map(([label, value]) => `${label}="${value}"`)
      .join(",");
    this.values.set(key, (this.values.get(key) ?? 0) + 1);
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    if (this.values.size === 0) {
      // Валидный exposition: счётчик без серий — просто 0 без меток.
      lines.push(`${this.name} 0`);
    } else {
      for (const [labels, value] of this.values) {
        lines.push(`${this.name}{${labels}} ${value}`);
      }
    }
    return lines.join("\n");
  }
}

class Gauge {
  private value = 0;

  constructor(
    private readonly name: string,
    private readonly help: string
  ) {}

  inc(by = 1): void {
    this.value += by;
  }

  dec(by = 1): void {
    this.value -= by;
  }

  set(value: number): void {
    this.value = value;
  }

  get(): number {
    return this.value;
  }

  render(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      `${this.name} ${this.value}`,
    ].join("\n");
  }
}

/** Сколько раз WS-подключению отказано из-за лимита соединений (global/per-user/per-IP). */
export const wsConnectionLimitHits = new Counter(
  "ws_connection_limit_hits_total",
  "Number of WebSocket connections rejected because a connection limit (global, per-user, or per-IP) was reached."
);

/** Сколько раз входящее WS-сообщение отброшено per-connection rate-лимитом. */
export const wsMessageRateHits = new Counter(
  "ws_message_rate_hits_total",
  "Number of WebSocket messages dropped because the per-connection rate limit was reached."
);

/** Сколько раз WS auth-попытка throttled per-IP handshake-лимитом. */
export const wsAuthThrottleHits = new Counter(
  "ws_auth_throttle_hits_total",
  "Number of WebSocket auth attempts throttled because the per-IP handshake rate limit was reached."
);

/** Текущее число открытых WS-соединений. */
export const wsConnections = new Gauge(
  "ws_connections",
  "Current number of open WebSocket connections."
);

/** Число авторизованных WS-пользователей (уникальные userId). */
export const wsAuthenticatedUsers = new Gauge(
  "ws_authenticated_users",
  "Current number of users with at least one authenticated WebSocket connection."
);

/** Все HTTP-запросы по (method, status); status="error" — необработанная ошибка. */
export const httpRequestsTotal = new LabeledCounter(
  "http_requests_total",
  "Total number of HTTP requests processed."
);

const METRICS: Array<{ render(): string }> = [
  httpRequestsTotal,
  wsConnectionLimitHits,
  wsMessageRateHits,
  wsAuthThrottleHits,
  wsConnections,
  wsAuthenticatedUsers,
];

/** Полный снимок метрик в Prometheus text-формате. */
export function metricsSnapshot(): string {
  return METRICS.map((metric) => metric.render()).join("\n") + "\n";
}
