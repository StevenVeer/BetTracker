import { useEffect, useRef } from 'react';
import { legLabel } from './components/BetList.jsx';
import { describeBet } from './markets.js';

function collectLegs(bets) {
  const map = new Map();
  for (const bet of bets) {
    const isCombi = bet.legs.length > 1;
    for (const leg of bet.legs) {
      map.set(leg.id, { status: leg.status, leg, isCombi, bookmaker: bet.bookmaker });
    }
  }
  return map;
}

// Notificeert alleen bij een echte overgang open -> won/lost, en alleen als
// we al een eerdere snapshot hadden - anders vuurt bij het allereerste laden
// meteen een notificatie af voor elke pick die toevallig al afgehandeld was.
// Werkt alleen zolang dit tabblad open is (geen service worker/push).
export function useSettlementNotifications(bets, telegramBets, enabled) {
  const prevRef = useRef(null);

  useEffect(() => {
    const current = collectLegs([...bets, ...telegramBets]);
    const canNotify = enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted';

    if (canNotify && prevRef.current) {
      for (const [legId, entry] of current) {
        const prev = prevRef.current.get(legId);
        if (prev && prev.status === 'open' && (entry.status === 'won' || entry.status === 'lost')) {
          const won = entry.status === 'won';
          new Notification(won ? '✅ Gewonnen' : '❌ Verloren', {
            body: `${legLabel(entry.leg)} — ${describeBet(entry.leg)}${
              entry.isCombi ? ` · combi bij ${entry.bookmaker}` : ` · ${entry.bookmaker}`
            }`,
            tag: legId,
          });
        }
      }
    }

    prevRef.current = current;
  }, [bets, telegramBets, enabled]);
}
