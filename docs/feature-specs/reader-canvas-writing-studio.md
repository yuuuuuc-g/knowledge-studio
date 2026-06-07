# Reader, Canvas And Writing Studio Spec

## Reader

Reader is the entry point for reading and material capture.

Required behaviors:

- Show reading text on the left.
- Keep Canvas visible on the right.
- Support highlight, annotation, quote extraction and vocabulary capture.
- Link every extracted note back to its original text range.

## Canvas

Canvas is the bridge from reading to thinking.

Required behaviors:

- Create nodes from selected text.
- Create AI-generated structure drafts.
- Link nodes back to text segments.
- Support manual editing.
- Save maps to Canvas Library.

Node types:

- concept
- claim
- question
- evidence
- counterargument
- example
- vocabulary

## Writing Studio

Writing Studio is the bridge from thinking to publication.

Required behaviors:

- Open from a CanvasMap.
- Import selected nodes into an outline.
- Provide rich text editing.
- Ask active questions before the user writes.
- Keep an interaction thread beside the draft.
- Allow final confirmation.

Prompt types:

- What is the central question behind this map?
- Which two ideas conflict with each other?
- What would you ask the author?
- Can you explain this idea in English?
- Which example from your own life proves or challenges this point?
- What would a Spanish reader need explained first?

## Confirmed Draft Actions

After confirmation, the user can:

- publish the manuscript
- share a link
- translate to English
- translate to Spanish
- generate an English picture book
- generate a Spanish picture book
- generate TTS audio
