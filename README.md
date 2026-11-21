# sokoban-solver-01

A Sokoban solver for generated hallway-and-rooms levels, entered in make.fun's
[sokoban-solver-01-run-20261121](https://make.fun/bounty/sokoban-solver-01-run-20261121).

The generator's levels are a hallway with one to four rooms off it. Each room holds its own
boxes and goals, and a box can never leave its room, so a level's push optimum is the sum of
its rooms' optima. The solver finds each room (the floor beyond a single doorway cell), solves
it on its own with a push-level A* whose estimate is every box's true push distance to a goal,
then walks the hallway between the doors and joins the pieces.

On the kit's practice set it reaches the push optimum on all five levels (13, 16, 29, 47 and
60 pushes) for the maximum score of 1,000,000, where the house baseline plain-astar reaches
200,000. Every search cap counts expansions, never the clock, so two runs on the same set
write the same bytes.

## Run it

```
MAKEFUN_INPUT_DIR=<dir of level folders> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

Each level folder holds a `level.txt` in XSB format; the solver writes `solution.txt` beside
it in the output tree, one folder per level.

[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Whydiriki700/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Whydiriki700/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Entered via [make.fun](https://make.fun/r/vwpycztt).

## License

MIT
