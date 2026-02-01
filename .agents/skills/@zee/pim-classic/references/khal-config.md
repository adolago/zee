# khal Configuration

Config file: `~/.config/khal/config`

## Basic Configuration

```ini
[calendars]

[[personal]]
path = ~/.local/share/vdirsyncer/calendars/google/personal@gmail.com/
color = dark green
type = discover

[[work]]
path = ~/.local/share/vdirsyncer/calendars/fastmail/work/
color = dark blue
type = discover

[default]
default_calendar = personal
highlight_event_days = True

[locale]
timeformat = %H:%M
dateformat = %d/%m/%Y
longdateformat = %d/%m/%Y
datetimeformat = %d/%m/%Y %H:%M
longdatetimeformat = %d/%m/%Y %H:%M
firstweekday = 0
# 0 = Monday, 6 = Sunday

[view]
agenda_event_format = {calendar-color}{cancelled}{start-end-time-style} {title}{repeat-symbol}{reset}
```

## Auto-discover Calendars

```ini
[calendars]

[[google]]
path = ~/.local/share/vdirsyncer/calendars/google/
type = discover
color = auto

[[fastmail]]
path = ~/.local/share/vdirsyncer/calendars/fastmail/
type = discover
color = auto
```

## Colors

Available colors:
- `dark red`, `dark green`, `dark blue`, `dark cyan`, `dark magenta`, `dark gray`
- `light red`, `light green`, `light blue`, `light cyan`, `light magenta`, `light gray`
- `white`, `black`
- Or hex: `#ff5733`

## Commands

### Interactive TUI

```bash
# Start interactive mode
khal interactive
# or
ikhal
```

**ikhal keybindings:**
| Key | Action |
|-----|--------|
| `n` | New event |
| `e` | Edit event |
| `d` | Delete event |
| `t` | Jump to today |
| `g` | Go to date |
| `left/right` | Previous/next day |
| `up/down` | Previous/next week |
| `q` | Quit |

### List Events

```bash
# Today's events
khal list

# Today + tomorrow
khal list today tomorrow

# Specific range
khal list 2024-01-01 2024-01-31

# Next 7 days
khal list today 7d

# With times
khal list --format "{start-time} - {end-time}: {title}"
```

### Add Events

```bash
# Quick event
khal new 15:00 16:00 "Meeting with John"

# With date
khal new 2024-01-15 15:00 16:00 "Meeting with John"

# All-day event
khal new 2024-01-15 "Company Holiday"

# With location
khal new 15:00 16:00 "Meeting" :: "Conference Room A"

# To specific calendar
khal new -a work 15:00 16:00 "Team standup"

# Recurring (every week)
khal new --repeat weekly 15:00 16:00 "Weekly sync"

# Until date
khal new --repeat weekly --until 2024-12-31 15:00 16:00 "Weekly sync"
```

### Edit/Delete Events

```bash
# Edit (interactive)
khal edit "Meeting"

# Delete
khal delete "Meeting"
```

### Import/Export

```bash
# Import .ics file
khal import event.ics

# Import to specific calendar
khal import -a work event.ics

# Export (show as ics)
khal list --format "{ics}"
```

### Search

```bash
# Search events
khal search "meeting"

# Search with date range
khal search --start 2024-01-01 --end 2024-03-01 "meeting"
```

## Format Strings

Available placeholders:
- `{title}` - Event title
- `{description}` - Event description
- `{location}` - Event location
- `{start}` - Start datetime
- `{end}` - End datetime
- `{start-time}` - Start time only
- `{end-time}` - End time only
- `{start-date}` - Start date only
- `{calendar}` - Calendar name
- `{calendar-color}` - ANSI color code
- `{reset}` - Reset color

Example format:
```ini
agenda_event_format = {calendar-color}{start-time}-{end-time} {title} @{location}{reset}
```

## Integration with Other Tools

### Remind/notify before events

```bash
# In cron, check for events starting in 15 min
*/5 * * * * khal list --format "{title}" now 15m | xargs -I{} notify-send "Upcoming: {}"
```

### Pipe to rofi/dmenu

```bash
khal list --format "{start-time} {title}" | rofi -dmenu
```
