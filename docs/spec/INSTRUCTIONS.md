# Claude Refactor Engine

## Project vision

Claude Refactor Engine is a platform whose goal is to turn Claude Code into a software engineer specialized in the evolution and maintenance of complete projects.

It is not meant to write applications from scratch.

Its purpose is to analyze, understand, improve, and maintain existing repositories in an intelligent, structured, and incremental way.

The core idea is that a developer can hand over a complete project and receive back a version that is cleaner, better organized, better documented, and with less technical debt.

The system should behave like a senior engineer who first understands the project, then plans the improvements, and only then begins to make changes.

It must never act impulsively.

There must always be a process of analysis → planning → execution → validation.

---

# Philosophy

The project's philosophy is that any significant change must be preceded by understanding.

The system should never modify code without knowing:

- what the project does
- how it is organized
- what dependencies exist
- what the architecture rules are
- what the critical parts are
- what risks each modification involves

The goal is not to produce a lot of code.

The goal is to improve the existing software.

---

# Main goal

Allow any developer to run a single command and get a project that is better than the original.

Not because Claude invented new features, but because it improved everything that normally takes hours or days of repetitive work.

---

# Concept

The project should work as a continuous improvement cycle.

Every iteration always follows the same process.

```
Understand

↓

Analyze

↓

Detect opportunities

↓

Prioritize

↓

Plan

↓

Execute

↓

Validate

↓

Document

↓

Continue
```

The system never stops looking for the next most valuable improvement.

---

# What "improving" means

Improving a project can mean many things.

For example:

- reduce complexity
- reduce duplication
- improve naming
- improve separation of responsibilities
- simplify code
- modularize
- reorganize folders
- remove technical debt
- improve documentation
- improve maintainability
- increase readability
- improve consistency
- remove dead code
- update conventions
- prepare the project to scale

There is no single definition.

The system must understand which improvement is right for each project.

---

# Principles

## Understanding before modification

Before changing a single file, the system must understand the project.

It must know:

- modules
- dependencies
- internal flow
- responsibilities
- relationships between components

---

## Small changes

It must never try to transform the whole project in a single operation.

It must break any large improvement into many small improvements.

Each change must be independent.

Each change must be reversible.

Each change must have a justification.

---

## Minimum risk

It must always choose first the improvements that deliver a lot of benefit at low risk.

For example:

- remove dead code
- rename variables
- split huge functions
- extract classes
- move files

Before huge migrations.

---

## Always explain

Every decision must be able to answer:

Why is it done?

What does it improve?

What problem does it solve?

What impact does it have?

---

# Main capabilities

## Complete understanding of the repository

It must build a mental model of the project.

It must understand:

- structure
- architecture
- modules
- relationships
- responsibilities
- information flow
- organization

It must not limit itself to analyzing files in isolation.

It must understand the complete system.

---

## Automatic problem detection

It must be able to locate improvement opportunities such as:

Duplicated code.

Functions that are too long.

Excessively large files.

Classes with too many responsibilities.

Unnecessary dependencies.

Dead code.

Mixed responsibilities.

Inconsistent architecture.

Non-descriptive names.

Repeated logic.

Unnecessary abstractions.

High coupling.

Excessive complexity.

Incomplete documentation.

Lack of coherence.

Poor organization.

And any other detectable problem.

---

## Prioritization system

Not all improvements have the same value.

It must be able to decide:

What to do first.

What to wait on.

What is worth it.

What contributes little.

It must always try to maximize the benefit gained from each modification made.

---

## Planner

Before modifying code it must generate a plan.

That plan must be divided into small tasks.

For example:

```
Separate responsibility A

↓

Extract module B

↓

Remove duplication

↓

Update documentation

↓

Validate
```

Each task must be executable independently.

---

# Execution

Each task must follow a process.

```
Analyze

↓

Modify

↓

Review

↓

Verify

↓

Explain

↓

Finalize
```

Never execute changes without review.

---

# Validation

After any modification it must check that the project is still correct.

If it detects problems it must try to solve them.

If it cannot solve them it must stop.

It must never hide errors.

---

# Learning the project

As it works it must understand the repository better and better.

It must remember:

- conventions
- style
- patterns
- architecture
- previous decisions

Each new improvement must be better than the previous one because it knows the project better.

---

# Continuous evolution

The project's main feature.

Instead of making a single pass, the system can enter a permanent cycle.

```
Find the best possible improvement.

Apply it.

Validate.

Document.

Find the next one.

Repeat.
```

Until there are no more relevant improvements.

---

# Intelligent refactoring

It is not only about moving files.

It must be able to:

Simplify.

Separate responsibilities.

Reduce complexity.

Remove duplication.

Organize better.

Reduce dependencies.

Improve clarity.

Improve cohesion.

Reduce coupling.

Increase maintainability.

---

# Automatic documentation

After understanding the project it must be able to generate useful documentation.

For example:

Overview.

Architecture.

Modules.

Dependencies.

Responsibilities.

Internal flow.

Critical points.

Important decisions.

Changes made.

Pending improvements.

The documentation must be kept in sync with the project.

---

# Architectural analysis

It must be able to identify:

Current architecture.

Structural problems.

Weak points.

Mixed layers.

Incorrect dependencies.

Modules that are too large.

Lack of separation.

And propose improvements.

---

# Modernization assistant

It must help update old projects.

Not only change syntax.

But also:

modernize organization

modernize patterns

modernize conventions

modernize structure

modernize documentation

modernize overall quality

---

# Auditor mode

It must be able to act purely as an analyst.

Without modifying anything.

Producing only a complete report on the state of the project.

---

# Planning mode

It must generate a complete plan without executing changes.

Ideal for reviewing before starting.

---

# Execution mode

It must apply only the selected tasks.

---

# Automatic mode

It must run the complete improvement cycle.

---

# Continuous mode

It must keep looking for new opportunities until it reaches a point of stability.

---

# Design principles

Everything must be:

Predictable.

Explainable.

Safe.

Incremental.

Reversible.

Audited.

Understandable.

---

# What it must NOT do

It must not reinvent the project.

It must not change functional behavior.

It must not introduce unnecessary changes.

It must not impose arbitrary styles.

It must not make huge modifications all at once.

It must not break compatibility without justifying it.

It must not modify code it does not understand.

---

# Target audience

Individual developers.

Open source projects.

Development teams.

Legacy repositories.

Companies with technical debt.

Library maintainers.

Any project that needs to evolve without losing stability.

---

# Long-term vision

The ultimate goal is not to build a simple refactorer.

The vision is to create a system capable of becoming an autonomous maintenance engineer for software projects.

A system that understands a repository just as an experienced developer would, detects real improvement opportunities, plans a coherent strategy, executes safe changes, and leaves the project in a better state than it found it.

It is not meant to replace the developer.

It is meant to take care of the repetitive, structural, and maintenance work so that developers can spend their time designing new features and solving business problems.

The goal is that, in the future, maintaining a project should be as simple as asking Claude to make it evolve in a continuous, transparent, and controlled way.
