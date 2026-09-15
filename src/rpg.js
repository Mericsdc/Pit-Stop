import { randomInt } from 'node:crypto';
import { SlashCommandBuilder, MessageFlags, escapeMarkdown } from 'discord.js';

export const RPG_ITEMS = Object.freeze([
  { id: 'demir-kilic', name: 'Demir kılıç', slot: 'sword', tier: 1, bonus: 2, price: 250 },
  { id: 'celik-kilic', name: 'Çelik kılıç', slot: 'sword', tier: 2, bonus: 4, price: 800 },
  { id: 'efsane-kilic', name: 'Efsanevi kılıç', slot: 'sword', tier: 3, bonus: 7, price: 2200 },
  { id: 'deri-zirh', name: 'Deri zırh', slot: 'armor', tier: 1, bonus: 1, price: 200 },
  { id: 'celik-zirh', name: 'Çelik zırh', slot: 'armor', tier: 2, bonus: 3, price: 650 },
  { id: 'efsane-zirh', name: 'Efsanevi zırh', slot: 'armor', tier: 3, bonus: 5, price: 1800 },
]);
export const RPG_MONSTERS = Object.freeze([
  { id: 'goblin', name: 'Goblin', defense: 3, reward: 100, xp: 40 },
  { id: 'trol', name: 'Mağara trolü', defense: 8, reward: 200, xp: 80 },
  { id: 'ejderha', name: 'Garaj ejderhası', defense: 15, reward: 400, xp: 160 },
]);
const waits = { work: 30 * 60_000, mine: 15 * 60_000, battle: 5 * 60_000 };
const equipment = id => RPG_ITEMS.find(item => item.id === id);
export const rpgLevel = xp => Math.floor(Math.sqrt(xp / 100)) + 1;
const initial = name => ({ name, coins: 0, xp: 0, wins: 0, losses: 0, sword: null, armor: null, inventory: [], cooldowns: {}, receipts: [] });
class RpgError extends Error {}
export function createRpg(store, { now = Date.now, roll = randomInt } = {}) {
  function profile(guildId, user) { return store.getRecord(guildId, 'rpg_player', user.id) || initial(user.globalName || user.username); }
  function act(guildId, user, action, choice, interactionId) {
    let result;
    store.updateRecord(guildId, 'rpg_player', user.id, saved => {
      const player = saved || initial(user.globalName || user.username);
      const timestamp = now();
      if (interactionId && player.receipts.includes(interactionId)) throw new RpgError('Bu işlem zaten tamamlandı. /profil ile durumunu görebilirsin.');
      if (waits[action] && (player.cooldowns[action] || 0) > timestamp) {
        throw new RpgError(`Bu işlem için ${Math.ceil((player.cooldowns[action] - timestamp) / 60_000)} dakika daha beklemelisin.`);
      }
      player.name = user.globalName || user.username;
      if (action === 'work' || action === 'mine') {
        const rare = action === 'mine' && roll(1, 101) <= 15;
        const earned = action === 'work' ? roll(50, 101) : rare ? roll(100, 181) : roll(25, 66);
        player.coins += earned;
        player.xp += action === 'work' ? 10 : rare ? 20 : 8;
        result = `${action === 'work' ? '🔧 Garajdaki vardiyan bitti.' : rare ? '💎 Madende nadir bir kristal buldun!' : '⛏️ Madenden cevher çıkardın.'}\n**+${earned} altın** · Bakiye: **${player.coins} altın**`;
      } else if (action === 'buy') {
        const item = equipment(choice);
        if (!item) throw new RpgError('Eşya bulunamadı. /mağaza ile seçeneklere bakabilirsin.');
        if (player.inventory.includes(item.id)) throw new RpgError('Bu eşya zaten envanterinde.');
        if (player.coins < item.price) throw new RpgError(`Altının yetmiyor. ${item.price - player.coins} altın daha gerekli.`);
        player.coins -= item.price;
        player.inventory.push(item.id);
        if ((equipment(player[item.slot])?.tier || 0) < item.tier) player[item.slot] = item.id;
        result = `🛍️ **${item.name}** satın aldın! En güçlü ekipmanın otomatik kuşanılır.\nBakiye: **${player.coins} altın**`;
      } else if (action === 'battle') {
        const monster = RPG_MONSTERS.find(item => item.id === choice);
        if (!monster) throw new RpgError('Geçerli bir canavar seç.');
        const die = roll(1, 21), enemyDie = roll(1, 21);
        const attack = (equipment(player.sword)?.bonus || 0) + Math.min(10, rpgLevel(player.xp) - 1);
        const armor = equipment(player.armor)?.bonus || 0;
        const total = die + attack + armor, enemy = enemyDie + monster.defense;
        const win = total >= enemy;
        if (win) { player.coins += monster.reward; player.xp += monster.xp; player.wins++; }
        else { player.losses++; }
        const lost = win ? 0 : Math.min(player.coins, Math.ceil(monster.reward / 5));
        player.coins -= lost;
        result = `⚔️ **${monster.name}**\nSen: d20 **${die}** + saldırı ${attack} + zırh ${armor} = **${total}**\nCanavar: d20 **${enemyDie}** + güç ${monster.defense} = **${enemy}**\n${win ? `🏆 Kazandın! +${monster.reward} altın · +${monster.xp} XP` : `Yenildin. ${lost} altın kaybettin; ekipmanın sende kaldı.`}\nBakiye: **${player.coins} altın** · Seviye **${rpgLevel(player.xp)}**`;
      } else throw new RpgError('Geçersiz RPG işlemi.');
      if (waits[action]) player.cooldowns[action] = timestamp + waits[action];
      if (interactionId) player.receipts = [...player.receipts.slice(-19), interactionId];
      player.updatedAt = timestamp;
      return player;
    });
    return result;
  }
  const command = (name, description, handler, configure = data => data) => ({
    data: configure(new SlashCommandBuilder().setName(name).setDescription(description).setContexts(0).setIntegrationTypes(0)),
    async execute(interaction) {
      if (!interaction.inGuild()) return interaction.reply({ content: 'Bu komutu bir sunucuda kullanın.', flags: MessageFlags.Ephemeral });
      await interaction.deferReply(name === 'sıralama' ? {} : { flags: MessageFlags.Ephemeral });
      try { await interaction.editReply({ content: handler(interaction), allowedMentions: { parse: [] } }); }
      catch (error) {
        if (!(error instanceof RpgError)) throw error;
        await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
      }
    },
  });
  const mutate = action => i => act(i.guildId, i.user, action, i.options?.getString(action === 'buy' ? 'eşya' : 'canavar'), i.id);
  const commands = [
    command('çalış', 'Garajda çalışıp altın ve XP kazan. Bekleme: 30 dakika.', mutate('work')),
    command('maden', 'Cevher ve nadir kristal bulup altın kazan. Bekleme: 15 dakika.', mutate('mine')),
    command('mağaza', 'Sanal kılıç ve zırh mağazasını göster.', () => `🛍️ **Pit-Stop mağazası**\n${RPG_ITEMS.map(item => `**${item.name}** — ${item.price} altın · +${item.bonus} ${item.slot === 'sword' ? 'saldırı' : 'savunma'}`).join('\n')}\n\n/satın-al ile satın al. En güçlü kılıç ve zırh otomatik kuşanılır.`),
    command('satın-al', 'Altınlarınla bir kılıç veya zırh satın al.', mutate('buy'), data => data.addStringOption(option => option.setName('eşya').setDescription('Almak istediğin ekipman').setRequired(true).addChoices(...RPG_ITEMS.map(item => ({ name: `${item.name} · ${item.price} altın`, value: item.id }))))),
    command('savaş', 'd20 zarlarıyla canavara meydan oku. Bekleme: 5 dakika.', mutate('battle'), data => data.addStringOption(option => option.setName('canavar').setDescription('Zorluk ve ödüle göre canavar seç').setRequired(true).addChoices(...RPG_MONSTERS.map(item => ({ name: `${item.name} · güç ${item.defense} · ${item.reward} altın`, value: item.id }))))),
    command('profil', 'Bakiyeni, seviyeni, ekipmanını ve savaş kaydını göster.', i => {
      const p = profile(i.guildId, i.user);
      return `🧙 **${escapeMarkdown(p.name)}**\nAltın: **${p.coins}** · XP: **${p.xp}** · Seviye: **${rpgLevel(p.xp)}**\nKılıç: ${equipment(p.sword)?.name || 'Yok'}\nZırh: ${equipment(p.armor)?.name || 'Yok'}\nGalibiyet: **${p.wins}** · Yenilgi: **${p.losses}**\nEnvanter: ${p.inventory.map(id => equipment(id)?.name).join(', ') || 'Boş'}\n\n/çalış · /maden · /mağaza · /savaş · /sıralama`;
    }),
    command('sıralama', 'Bu sunucunun en iyi 10 RPG oyuncusunu göster.', i => {
      const players = store.rpgLeaderboard(i.guildId);
      return `🏆 **Sunucu RPG sıralaması**\nÖnce XP, eşitlikte galibiyet ve altın.\n\n${players.map((p, index) => `**${index + 1}.** ${escapeMarkdown(p.name)} — ${p.xp} XP · ${p.wins} galibiyet · ${p.coins} altın`).join('\n') || 'Henüz oyuncu yok. /çalış veya /maden ile başla.'}`;
    }),
  ];
  return { commands, act, profile };
}
