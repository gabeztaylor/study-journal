# Study Journal (local)

This is a tiny local HTML app that appends study sessions to:

- `gabeztaylor.github.io/docs/Studying.md`

## Run

From `~/Desktop/study-journal`:

```bash
npm start
```

Then open `http://localhost:3030`.

## One-click launcher (Mac)

You can double-click:

- `study-journal/launch.command`

First time only:

```bash
chmod +x ~/Desktop/study-journal/launch.command
```

## What gets written

- If today’s `### M/D/YY` section exists, it inserts your new entry **at the end of that date section** (before the next date header).
- If it doesn’t exist, it appends a new date section to the end of the file.

