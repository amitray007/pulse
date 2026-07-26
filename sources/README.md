# Sources

Source adapters live here — each teaches Pulse how to accept one kind of raw payload and turn it
into generic events by implementing the `Source` interface from `@pulse/core`
(`payload -> EventInput[]`).

Pulse ships with **no** source adapters by default; it's a generic telemetry platform. Add your own
package here (see [CONTRIBUTING.md](../CONTRIBUTING.md) → "Adding a new source"). Your app can also
POST generic events directly to the collector without any adapter at all.
