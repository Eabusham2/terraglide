p='server/game.mjs'
s=open(p).read()
old="""      // Down as well as up, flying: a fall is free to make, but no fall is
      // faster than the speed it gives you, which the limit has in it - and
      // dropping five kilometres in one state onto somebody below was a
      // critical hit out of a clear sky.
      const back = before(player.history, now - 500);
      if (back) {
        const span = Math.max(0.5, (now - back.t) / 1000);
        const across = separation({ lat: back.lat, lon: back.lon, alt: s.alt }, s, radius);
        const up = settled && !walking ? Math.abs(s.alt - back.alt) : 0;
        if (Math.hypot(across, up) > limit * span + BLINK_SLACK_M) player.blinkUntil = now + BLINK_GUARD_MS;
      }"""
new="""      // Down too, flying: a fall is free to make, but it gathers speed as falls
      // do. Dropping five kilometres in one state onto somebody below was a
      // critical hit out of a clear sky. So a drop faster than the page was
      // already dropping counts, the extra against the limit like any other
      // move - while a dive keeping the speed it has counts nothing, however
      // fast, or every honest dive on the Moon would be a blink.
      const back = before(player.history, now - 500);
      if (back) {
        const span = Math.max(0.5, (now - back.t) / 1000);
        const across = separation({ lat: back.lat, lon: back.lon, alt: s.alt }, s, radius);
        const flying = settled && !walking;
        const up = flying ? Math.max(0, s.alt - back.alt) : 0;
        let sooner = 0;
        if (flying && back.alt > s.alt) {
          const earlier = before(player.history, back.t - 500);
          const falling = earlier ? Math.max(0, earlier.alt - back.alt) / Math.max(0.5, (back.t - earlier.t) / 1000) : 0;
          sooner = Math.max(0, back.alt - s.alt - falling * span);
        }
        if (Math.hypot(across, up, sooner) > limit * span + BLINK_SLACK_M) player.blinkUntil = now + BLINK_GUARD_MS;
      }"""
assert s.count(old)==1, s.count(old)
s=s.replace(old,new,1); open(p,'w').write(s); print('ok')
