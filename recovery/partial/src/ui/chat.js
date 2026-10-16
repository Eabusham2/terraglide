@@MISSING 1@@
@@MISSING 2@@
@@MISSING 3@@
@@MISSING 4@@
@@MISSING 5@@
@@MISSING 6@@
@@MISSING 7@@
@@MISSING 8@@
@@MISSING 9@@
@@MISSING 10@@
@@MISSING 11@@
@@MISSING 12@@
@@MISSING 13@@
@@MISSING 14@@
@@MISSING 15@@
@@MISSING 16@@
@@MISSING 17@@
@@MISSING 18@@
@@MISSING 19@@
@@MISSING 20@@
@@MISSING 21@@
@@MISSING 22@@
@@MISSING 23@@
@@MISSING 24@@
@@MISSING 25@@
@@MISSING 26@@
@@MISSING 27@@
@@MISSING 28@@
@@MISSING 29@@
@@MISSING 30@@
@@MISSING 31@@
@@MISSING 32@@
@@MISSING 33@@
@@MISSING 34@@
@@MISSING 35@@
@@MISSING 36@@
@@MISSING 37@@
@@MISSING 38@@
@@MISSING 39@@
@@MISSING 40@@
@@MISSING 41@@
@@MISSING 42@@
@@MISSING 43@@
@@MISSING 44@@
@@MISSING 45@@
@@MISSING 46@@
@@MISSING 47@@
@@MISSING 48@@
@@MISSING 49@@
@@MISSING 50@@
@@MISSING 51@@
@@MISSING 52@@
@@MISSING 53@@
@@MISSING 54@@
@@MISSING 55@@
@@MISSING 56@@
@@MISSING 57@@
@@MISSING 58@@
@@MISSING 59@@
@@MISSING 60@@
@@MISSING 61@@
@@MISSING 62@@
@@MISSING 63@@
@@MISSING 64@@
@@MISSING 65@@
@@MISSING 66@@
@@MISSING 67@@
@@MISSING 68@@
@@MISSING 69@@
@@MISSING 70@@
@@MISSING 71@@
@@MISSING 72@@
@@MISSING 73@@
@@MISSING 74@@
@@MISSING 75@@
@@MISSING 76@@
@@MISSING 77@@
@@MISSING 78@@
@@MISSING 79@@
@@MISSING 80@@
@@MISSING 81@@
@@MISSING 82@@
@@MISSING 83@@
@@MISSING 84@@
@@MISSING 85@@
@@MISSING 86@@
@@MISSING 87@@
@@MISSING 88@@
@@MISSING 89@@
@@MISSING 90@@
@@MISSING 91@@
@@MISSING 92@@
@@MISSING 93@@
@@MISSING 94@@
@@MISSING 95@@
@@MISSING 96@@
@@MISSING 97@@
@@MISSING 98@@
@@MISSING 99@@
@@MISSING 100@@
@@MISSING 101@@
@@MISSING 102@@
@@MISSING 103@@
@@MISSING 104@@
@@MISSING 105@@
@@MISSING 106@@
@@MISSING 107@@
@@MISSING 108@@
@@MISSING 109@@
@@MISSING 110@@
@@MISSING 111@@
@@MISSING 112@@
@@MISSING 113@@
@@MISSING 114@@
@@MISSING 115@@
@@MISSING 116@@
@@MISSING 117@@
@@MISSING 118@@
@@MISSING 119@@
@@MISSING 120@@
@@MISSING 121@@
@@MISSING 122@@
@@MISSING 123@@
@@MISSING 124@@
@@MISSING 125@@
@@MISSING 126@@
@@MISSING 127@@
@@MISSING 128@@
@@MISSING 129@@
@@MISSING 130@@
@@MISSING 131@@
@@MISSING 132@@
@@MISSING 133@@
@@MISSING 134@@
@@MISSING 135@@
@@MISSING 136@@
@@MISSING 137@@
@@MISSING 138@@
@@MISSING 139@@
@@MISSING 140@@
@@MISSING 141@@
@@MISSING 142@@
@@MISSING 143@@
@@MISSING 144@@
@@MISSING 145@@
@@MISSING 146@@
@@MISSING 147@@
@@MISSING 148@@
@@MISSING 149@@
@@MISSING 150@@
@@MISSING 151@@
@@MISSING 152@@
@@MISSING 153@@
@@MISSING 154@@
@@MISSING 155@@
@@MISSING 156@@
@@MISSING 157@@
@@MISSING 158@@
@@MISSING 159@@
@@MISSING 160@@
@@MISSING 161@@
@@MISSING 162@@
@@MISSING 163@@
@@MISSING 164@@
@@MISSING 165@@
@@MISSING 166@@
@@MISSING 167@@
@@MISSING 168@@
@@MISSING 169@@
@@MISSING 170@@
@@MISSING 171@@
@@MISSING 172@@
@@MISSING 173@@
@@MISSING 174@@
@@MISSING 175@@
@@MISSING 176@@
    const reach = command?.name === 'near' ? ` (within ${formatDistance(NEAR_CHAT_M, settings.get('units'), 0)})` : '';
@@MISSING 178@@
@@MISSING 179@@
@@MISSING 180@@
@@MISSING 181@@
@@MISSING 182@@
@@MISSING 183@@
@@MISSING 184@@
@@MISSING 185@@
@@MISSING 186@@
@@MISSING 187@@
@@MISSING 188@@
@@MISSING 189@@
@@MISSING 190@@
      case 'near':
        line.innerHTML = `<em>nearby</em> ${name(m.from)} ${text}`;
        break;
      case 'whisper':
        line.innerHTML = `<em>${escapeHtml(m.from.name)} whispers</em> ${text}`;
        break;
      case 'whisperSent':
        line.innerHTML = `<em>to ${escapeHtml(m.to.name)}</em> ${text}`;
        break;
      case 'me':
        line.innerHTML = `* ${name(m.from)} ${text}`;
        break;
      case 'party':
        // Party chat has a speaker; the party's own notices do not.
        line.innerHTML = m.from ? `<em>party</em> ${name(m.from)} ${text}` : `<em>party</em> ${text}`;
        break;
      case 'friend':
        line.innerHTML = `<em>friends</em> ${text}`;
        break;
      default:
        line.innerHTML = text;
    }
    this.log.appendChild(line);
    while (this.log.children.length > KEEP) this.log.removeChild(this.log.firstChild);
    this.log.scrollTop = this.log.scrollHeight;
    this.fade();
  }

  /** Lines older than a few seconds go quiet unless the box is open. */
  fade() {
    const now = performance.now();
    for (const line of this.log.children) {
      const old = now - Number(line.dataset.at) > FADE_MS;
      line.classList.toggle('faded', old && !this.open);
    }
  }

  /** The keys that open it, for the hint on the HUD. */
  static keys() {
    return `${keybinds.labelFor('chat')} chat · ${keybinds.labelFor('command')} command`;
  }
}

function worldTag(from) {
  if (!from?.world || from.world === 'earth') return '';
  return `<em class="chat-world">${escapeHtml(BODIES[from.world]?.name ?? from.world)}</em> `;
}
