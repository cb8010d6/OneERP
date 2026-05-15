---
name: grill-me
description: Deep-dive interview to uncover hidden assumptions and reach shared understanding. Use when a plan is complex, has high risk, or when you want the user to challenge your design.
---

# Grill Me

## Philosophy

The best designs survive scrutiny. "Grilling" is a process of asking tough questions to ensure every angle has been considered. It's not about finding fault; it's about finding clarity.

## Workflow

### 1. Preparation

The proposer (usually the AI) presents a clear plan or design.

- [ ] Clear goal statement
- [ ] Proposed implementation steps
- [ ] Identified risks

### 2. The Grilling

The interviewer (the user, or the AI acting as a devil's advocate) asks a series of "How", "Why", and "What if" questions.

- [ ] "How does this handle [Edge Case X]?"
- [ ] "Why choose [Approach A] over [Approach B]?"
- [ ] "What if [Dependency Y] is unavailable?"

**Resolution**: Each question must be answered. If an answer is unknown, it becomes a research task.

### 3. Decision Tree Resolution

The grilling continues until all branches of the decision tree have a recommended path.

- [ ] No "we'll figure this out later" allowed for critical paths
- [ ] Trade-offs are explicitly documented

### 4. Final Approval

Once the proposer has successfully answered the questions, the plan is updated and approved.

## Tips for the Interviewer

- Be relentless but constructive
- Focus on boundaries and interfaces
- Look for state management complexities
- Ask about failure modes

## Tips for the Proposer

- Don't be defensive
- If you don't know, say so (and then go find out)
- Use examples to clarify complex logic
- Document the "Why" behind choices
