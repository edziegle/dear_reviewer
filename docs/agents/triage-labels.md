# Triage Labels

The skills speak of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                                                  |
| -------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `needs-triage`             | `needs-triage`       | Maintainer needs to assess this issue                                    |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information                                 |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an agent working away from the keyboard (AFK) |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation                                            |
| `wontfix`                  | `wontfix`            | Will not be acted on                                                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## Priority

An issue can also carry one priority label, separate from its triage role:

| Label              | Meaning       |
| ------------------ | ------------- |
| `priority: high`   | Do next       |
| `priority: medium` | Do soon       |
| `priority: low`    | Do eventually |

When picking the next issue to work on, take `priority: high` first, then `priority: medium`, then unlabeled issues, then `priority: low`.
