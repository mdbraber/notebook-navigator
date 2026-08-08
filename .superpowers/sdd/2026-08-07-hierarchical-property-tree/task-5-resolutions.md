# Task 5 resolutions

The brief for Task 5 is the vaguest in the plan. I read the code afterwards and found seven touch
points where it named two. This file is authoritative wherever it and the brief disagree.

Scope note: the brief bundled `collapseOtherBranchesOnExpand` into this task. It has been **split out
into Task 6**, because making it work per placement reworks `toggleNavigationExpansionTarget`, which
folders and tags also use. Task 5 leaves that path falling back to the plain dispatch for hierarchical
keys. Do not attempt it here.

## The model

A placement key is the chain of value node ids from the root, joined with `String.fromCharCode(0)`
(`buildPropertyPlacementKey`, `src/utils/treeFlattener.ts:460`). A **root** placement's chain is just
its own node id, so its key equals the node id. Every deeper placement's key contains a NUL.

`expansionState.expandedProperties` is a `Set<string>`. After this task it holds **placement keys** for
hierarchical property values. Because a root's key equals its node id, existing persisted expansion for
root values keeps working and no migration is needed. Key nodes keep using their own node id.

## 1. `isExpanded`, at `src/components/navigationPane/NavigationPaneContent.tsx:1096`

Currently `isExpanded = expansionState.expandedProperties.has(item.data.id)`. For a
`PROPERTY_VALUE` item this must test `item.key`, which the emitter already set to the placement key in
Task 4. For `PROPERTY_KEY` items keep `item.data.id`. Check whether line 1096 is shared by both item
types before editing; if it is, branch on `item.type`.

## 2. The toggle, at `src/components/navigationPane/NavigationPaneTreeRow.tsx:259`

Currently `onToggle={() => tree.handlePropertyToggle(propertyNode.id)}`. `item` is in scope in that
case block. Pass the placement key, and also pass the node id, because `handlePropertyToggle` needs the
node for its collapse-others path. Widen the signature rather than guessing:

```ts
handlePropertyToggle: (placementKey: string, nodeId: string) => void;
```

Update the interface at `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:101` and every
caller. There is at least one other caller at `:723`.

## 3. `handlePropertyToggle`, at `useNavigationPaneTreeInteractions.ts:331-360`

The final dispatch becomes the placement key:

```ts
expansionDispatch({ type: 'TOGGLE_PROPERTY_EXPANDED', propertyNodeId: placementKey });
```

The `settings.collapseOtherBranchesOnExpand` branch resolves a node via `findNode(nodeId)` and
`node.children.has(nodeId)`, then passes `ancestorIds: getPropertyAncestorNodeIds(targetNode.id)`. That
is node-id reasoning and cannot express a placement.

**For Task 5: take that branch only when the placement key equals the node id**, meaning a root
placement or a non-hierarchical value, where node-id reasoning is still correct. Otherwise fall through
to the plain dispatch. Add a comment saying per-placement collapse-others is Task 6, so the next reader
knows it is deliberate rather than forgotten.

`ExpansionContext.tsx:48` declares the action as `{ type: 'EXPAND_PROPERTIES'; propertyNodeIds: string[] }`
and `TOGGLE_PROPERTY_EXPANDED` similarly names its payload for node ids. The field names now carry
placement keys for hierarchical values. Update those comments; do not rename the fields, because that
would touch folders and tags for no behavioural gain.

## 4. The four `children.size > 0` sites

A hierarchical value node's `children` map is always empty, because the tree is never reparented. So
every one of these currently reports "no children" and silently does nothing:

| Site | What breaks |
|---|---|
| `src/hooks/useNavigationPaneKeyboard.ts:233` | `autoExpandNavItems` never expands a hierarchical value |
| `useNavigationPaneTreeInteractions.ts:344` | inside the collapse-others path; Task 6 owns this one, leave it |
| `useNavigationPaneTreeInteractions.ts:640` | `hasChildren` for the click handler |
| `useNavigationPaneTreeInteractions.ts:722` | auto-expand on click |

Fix `:233`, `:640` and `:722`. They need to ask the hierarchy index instead. Thread
`propertyHierarchyIndex` into those hooks the same way other navigation data already reaches them, and
compute children presence as: the node's own `children.size > 0`, or the index reporting children for
that node id. That fallback keeps flat keys behaving exactly as today.

**Known related defect, deliberately not fixed here.** `hasChildren` on the item is raw
`childIds.length > 0` and ignores the flattener's depth cap and its cycle filter, so a placement at the
cap, or one whose only child is its own ancestor, gets a chevron that expands to nothing. It is recorded
as a deferred minor. Do not fix it in this task, but do not make it worse: if you add a helper for
children presence, put it where a later fix can correct all callers at once.

## 5. Auto-reveal to the first placement

Task 4 surfaced `firstPlacementByNodeId: Map<string, string>` on the tree sections result. Reveal
resolves a value node id; map it through that, then expand every ancestor prefix of the chain:

```ts
const chain = placementKey.split(String.fromCharCode(0));
const ancestorKeys = chain.slice(0, -1).map((_, index) => buildPropertyPlacementKey(chain.slice(0, index + 1)));
```

Dispatch `EXPAND_PROPERTIES` with those keys. When the node id has no entry in
`firstPlacementByNodeId`, fall back to the node id itself, which is correct for a non-hierarchical key.

Find the existing property reveal path rather than inventing one; it is the code that currently
dispatches `EXPAND_PROPERTIES`.

## 6. Verify in the vault

The specific thing Task 4 could not do: expanding `Clients` under `Work` must now reveal
`Datawerkplaats Mooi Maasvallei` at level 3. Also confirm that expanding `Clients` under one parent for a
multi-parent value leaves its other placement collapsed. In `~/2027` the multi-parent values are under
`categories`: `Clients` sits under both `Areas` and `Categories`, and `Software` under both `Categories`
and `Topics`.
