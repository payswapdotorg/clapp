# Security, Authorization, and Abuse Boundaries

## 1. Authorized-use model

CLAPP should be designed for:
- applications owned by the user
- applications where the user has explicit permission
- open-source applications subject to their licenses
- interoperability/testing environments
- controlled research benchmarks

The system must capture an authorization statement or benchmark ownership record before observation begins.

## 2. Explicit non-goals

The product must not be designed around:
- bypassing DRM
- bypassing platform attestation
- defeating authentication
- stealing credentials/session tokens
- disabling anti-tamper systems
- evading rate limits
- unauthorized access to private backends

When a target depends on a security control, CLAPP should report the limitation and either use an authorized integration or mark the behavior unreproducible.

## 3. Secret handling

The observation pipeline must classify sensitive fields:
- cookies
- Authorization headers
- bearer tokens
- API keys
- passwords
- private user data

Default behavior:
- redact from durable evidence
- keep only short-lived in-memory references where required
- make redaction visible in provenance
- never train package retrieval directly on raw secrets

## 4. Sandboxing

Generated applications and untrusted target artifacts must run inside isolation with:
- filesystem boundaries
- CPU/memory budgets
- process limits
- network allowlists/egress controls
- execution timeouts
- artifact quotas

## 5. Package supply chain

Every package records:
- provenance
- dependencies
- source/license metadata where available
- build hash
- security scan result
- test suite version

Automatic promotion should require a clean dependency and security evaluation.

## 6. Data isolation

Separate:
- user project data
- target app evidence
- generated code
- package library
- benchmark corpus

Library promotion must never accidentally publish private project data.

## 7. Product language

Use language such as:
- behavioral reconstruction
- compatibility implementation
- software migration
- parity engineering
- authorized reverse engineering

Avoid promising universal source recovery or a guaranteed perfect copy of arbitrary software.
