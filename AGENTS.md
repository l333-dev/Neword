# Personal Document Editor — Development Instructions

## Project purpose

This repository contains a personal desktop document editor.

The application imports DOCX files, converts supported document structures into an internal document format, allows the user to edit them, and exports a newly generated DOCX file.

The finished application must not use AI models, AI APIs, cloud document conversion services, or external document-processing servers at runtime.

All document processing must work locally and offline.

This application is not intended to be fully compatible with Microsoft Word. It should preserve supported semantic document structures reliably and warn the user about unsupported structures.

## Primary platform

* Ubuntu Linux
* Future compatibility with Windows and macOS should be preserved where practical.

## Technology stack

* Tauri 2
* React
* TypeScript
* Vite
* pnpm
* Tiptap
* Zod
* Mammoth.js
* docx.js
* Rust
* Vitest
* ESLint
* Prettier

Use stable versions that are compatible with each other. Do not replace the selected stack without explaining the reason.

## Architecture

Keep the following responsibilities separate:

* `src/components/`

  * Reusable user-interface components
* `src/features/editor/`

  * Tiptap editor configuration and editor-specific UI
* `src/features/import-docx/`

  * DOCX import workflow and conversion preview
* `src/features/export-docx/`

  * DOCX export workflow
* `src/document-model/`

  * Internal document types, Zod schemas and migrations
* `src/converters/`

  * Pure conversion functions
* `src/classification/`

  * Rule-based block classification
* `src/project/`

  * Project save, load and autosave logic
* `src/stores/`

  * Application state
* `src-tauri/src/commands/`

  * Tauri commands
* `src-tauri/src/docx/`

  * Safe DOCX ZIP and OOXML processing
* `tests/fixtures/`

  * Test DOCX documents
* `docs/`

  * Architecture, supported features and limitations

UI components must not contain DOCX parsing or DOCX generation logic.

DOCX import and export must use separate intermediate models. Do not tightly couple Mammoth HTML, Tiptap JSON and docx.js classes.

## Runtime restrictions

The finished application must not:

* Call OpenAI or another AI API
* Require an internet connection
* Upload document contents
* Send telemetry containing document contents
* Execute macros
* Download externally linked images automatically
* Overwrite the original DOCX file
* Silently discard unsupported document elements

## TypeScript rules

* Enable strict mode
* Do not use `any` unless absolutely unavoidable
* Validate data loaded from disk with Zod
* Prefer discriminated unions for document blocks
* Use exhaustive checks for document block types
* Keep unit-conversion functions in one module
* Make conversion functions pure where practical

## Rust rules

* Run `cargo fmt`
* Avoid `unwrap()` and `expect()` in normal runtime code
* Return structured errors to the frontend
* Validate ZIP paths before extraction
* Limit uncompressed document and image sizes
* Reject malformed DOCX packages safely
* Do not execute or preserve macros without a visible warning
* Do not log document text or image content

## Document safety

Always preserve the original imported file separately.

Use the following conceptual structure:

* Original source file
* Internal editable project
* Exported DOCX

Never modify the original DOCX in place.

Unsupported content must produce an `ImportWarning`. It must not disappear silently.

## Internal document format

Create a versioned `DocumentProject` schema.

It must support at least:

* Metadata
* Source-file information
* Page settings
* Tiptap editor content
* Assets
* Import warnings
* Rule-classification results
* Import time
* Last-save time
* Last-export time
* Format version

Provide migration infrastructure before changing the stored format.

## DOCX import policy

Use Mammoth.js for semantic DOCX-to-HTML conversion.

Use safe OOXML parsing to supplement information that Mammoth does not preserve, including page settings, paragraph settings, styles, numbering, headers, footers and relationships.

Do not attempt to implement every OOXML feature.

Use a documented supported-feature list and emit warnings for unsupported features.

Sanitize imported HTML before passing it to the editor.

## Classification policy

Classify blocks deterministically without AI.

Use this priority:

1. Explicit Word style
2. Numbering and list metadata
3. Paragraph and run formatting
4. Configurable text-pattern rules
5. Paragraph or unknown fallback

Every classification should record:

* Resulting type
* Heading level when applicable
* Rule identifier
* Human-readable reason
* Certainty level

Rules must be stored in dedicated modules or configuration files, not scattered through UI components.

## DOCX export policy

Generate a new DOCX file from the internal document model.

Do not attempt to patch the original DOCX.

Implement exports through a dedicated normalized `ExportDocument` model before constructing docx.js objects.

Keep conversions between mm, points, twips, half-points and EMUs in one tested module.

## Testing requirements

For each feature:

1. Add or update tests
2. Run TypeScript type checking
3. Run linting
4. Run frontend unit tests
5. Run Rust formatting and checks
6. Report commands and results

Important tests include:

* Japanese text
* Empty documents
* Broken DOCX packages
* ZIP path traversal attempts
* Excessively large entries
* Unsupported elements
* Import warnings
* Project migrations
* Import-export-import round trips
* Tables
* Lists
* Images
* Page settings

## Development workflow

Before making a substantial change:

1. Inspect the current repository
2. Explain the affected modules
3. Give a concise implementation plan
4. Identify risks and unsupported cases

After making a change:

1. List changed files
2. List commands executed
3. Report test results
4. Report remaining limitations
5. Do not claim success when a command failed

Do not create Git commits unless explicitly requested.

Do not rewrite unrelated code.

Prefer small, reviewable stages over one large implementation.

## Common commands

Use project scripts where available:

* `pnpm install`
* `pnpm tauri dev`
* `pnpm typecheck`
* `pnpm lint`
* `pnpm test`
* `pnpm build`
* `cargo fmt --check`
* `cargo check`
* `cargo test`

## Definition of done

A task is complete only when:

* The implementation works
* Relevant tests exist
* Type checking passes
* Linting passes
* Rust checks pass
* Documentation is updated
* Unsupported behavior is documented
* No document content is transmitted externally

