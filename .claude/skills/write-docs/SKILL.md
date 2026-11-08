---
name: write-docs
description: Write or change Osusume documentation (README, docs/, CONTRIBUTING, skills) in ASD-STE100 Simplified Technical English and check it with a reader agent. Use for any document a person will read.
---

# Write documents

All documents use ASD-STE100 Simplified Technical English. The rules are in `CONTRIBUTING.md`, section "Writing rules for documents".

1. Put the document in the correct place:
   - Setup and procedures: `docs/development.md`.
   - How the parts connect and the rules that the code keeps: `docs/architecture.md`.
   - The look of the web app: `docs/design-guide.md`.
   - Process: `CONTRIBUTING.md`. Agent rules: `CLAUDE.md`.
   - Do not make a new document if one of these is correct.
2. Write the text. Check each sentence:
   - 20 words or less in a procedure, 25 words or less in a description.
   - Active voice. Imperative for instructions. One instruction in each sentence.
   - One term for one thing.
   - No contractions. "Do not", not "don't".
3. Check each fact against the code: file paths, commands, ports, variable names. Run each new command one time if it is safe.
4. For a large change, give the document to a reader sub-agent. Tell it to act as a new developer whose first language is not English, and to list each sentence that is not clear, each step that does not work, and each fact that the code does not agree with.
