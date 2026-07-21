"""Operational instrumentation shared across every ShowUp service.

`heartbeat` - each service reports liveness to one table the ops dashboard reads.
`errors`    - each service records failures to one table the ops dashboard reads.

Both are dependency-light (psycopg2 + stdlib) and self-creating, so any service
can call them regardless of boot order, and the ops dashboard has a single,
uniform source of truth for platform health.
"""
