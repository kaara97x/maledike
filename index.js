'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║              DISCORD BOT — MANAGER COMPLET                   ║
// ║  Auto-role | Massive Roles | +create | OwnerBot | Keep-Alive ║
// ╚══════════════════════════════════════════════════════════════╝

const {
    Client, GatewayIntentBits, Partials, REST, Routes,
    SlashCommandBuilder, EmbedBuilder, ActivityType
} = require('discord.js');

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ──────────────────────────────────────────────────────────────
//  CONFIG — à définir dans les variables d'environnement Render
// ──────────────────────────────────────────────────────────────
const TOKEN          = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL || 'https://maledike-sh7b.onrender.com';
const PORT           = parseInt(process.env.PORT) || 3000;
const PREFIX         = '+';

if (!TOKEN) {
    console.error('[FATAL] DISCORD_TOKEN manquant dans les variables d\'environnement !');
    process.exit(1);
}

// ──────────────────────────────────────────────────────────────
//  PERSISTANCE AVANCÉE — bot_data.json
// ──────────────────────────────────────────────────────────────
const DATA_PATH = path.join(process.cwd(), 'bot_data.json');

const DEFAULT_DATA = {
    ownerBots:   ['685679698054742017', '465620464232955911'],
    createUsers: [],
    guilds:      {}
};

function loadData() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
            return {
                ownerBots:   Array.isArray(parsed.ownerBots)   ? parsed.ownerBots   : [...DEFAULT_DATA.ownerBots],
                createUsers: Array.isArray(parsed.createUsers) ? parsed.createUsers : [],
                guilds:      parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {}
            };
        }
    } catch (e) {
        console.error('[DATA] Erreur lecture:', e.message);
    }
    const fresh = JSON.parse(JSON.stringify(DEFAULT_DATA));
    saveData(fresh);
    return fresh;
}

function saveData(d) {
    try {
        fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2), 'utf8');
    } catch (e) {
        console.error('[DATA] Erreur sauvegarde:', e.message);
    }
}

let db = loadData();
console.log('[DATA] ✅ Données chargées — OwnerBots:', db.ownerBots.length, '| CreateUsers:', db.createUsers.length);

function guildDB(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = { autoRole: null };
        saveData(db);
    }
    return db.guilds[guildId];
}

// ──────────────────────────────────────────────────────────────
//  KEEP-ALIVE HTTP + SELF-PING SILENCIEUX
// ──────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    const data = {
        status:  'online',
        bot:     client?.user?.tag  || 'connecting...',
        uptime:  Math.floor(process.uptime()),
        guilds:  client?.guilds?.cache?.size || 0,
        ping:    client?.ws?.ping   || -1,
        owners:  db.ownerBots.length,
        time:    new Date().toISOString()
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
});

httpServer.on('error', err => console.error('[SERVER] Erreur HTTP:', err.message));

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] ✅ Keep-alive HTTP sur port ${PORT}`);
});

// Self-ping silencieux — empêche Render de mettre le service en veille
function selfPing() {
    const lib = KEEP_ALIVE_URL.startsWith('https') ? https : http;
    const req = lib.get(KEEP_ALIVE_URL, { timeout: 15_000 }, () => {});
    req.on('error',   () => {});
    req.on('timeout', () => req.destroy());
}

// Attendre 90s avant le 1er ping, puis toutes les 4 minutes
setTimeout(() => {
    selfPing();
    setInterval(selfPing, 4 * 60 * 1000);
}, 90_000);

// ──────────────────────────────────────────────────────────────
//  CLIENT DISCORD
// ──────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
    rest: { timeout: 30_000, retries: 5 }
});

// ──────────────────────────────────────────────────────────────
//  DÉFINITION DES COMMANDES SLASH
// ──────────────────────────────────────────────────────────────
const SLASH_COMMANDS = [
    // Auto-rôle
    new SlashCommandBuilder()
        .setName('setautorole')
        .setDescription('[OwnerBot] Définir le rôle automatique pour les nouveaux membres')
        .addRoleOption(o => o.setName('role').setDescription('Rôle à attribuer automatiquement').setRequired(true)),

    new SlashCommandBuilder()
        .setName('removeautorole')
        .setDescription('[OwnerBot] Désactiver l\'auto-rôle de ce serveur'),

    new SlashCommandBuilder()
        .setName('autoroleinfo')
        .setDescription('[OwnerBot] Voir l\'auto-rôle actuellement configuré'),

    // Statistiques rôle
    new SlashCommandBuilder()
        .setName('rolecount')
        .setDescription('[OwnerBot] Voir combien de membres ont un rôle')
        .addRoleOption(o => o.setName('role').setDescription('Rôle à compter').setRequired(true)),

    // Attribution / retrait massif
    new SlashCommandBuilder()
        .setName('massiveroles')
        .setDescription('[OwnerBot] Attribuer un rôle à TOUS les membres du serveur')
        .addRoleOption(o => o.setName('role').setDescription('Rôle à distribuer à tous').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unmassiveroles')
        .setDescription('[OwnerBot] Retirer un rôle de TOUS les membres qui l\'ont')
        .addRoleOption(o => o.setName('role').setDescription('Rôle à retirer de tous').setRequired(true)),

    // Gestion des OwnerBots
    new SlashCommandBuilder()
        .setName('ownerbot')
        .setDescription('[OwnerBot] Gérer les propriétaires du bot')
        .addSubcommand(s => s.setName('add').setDescription('Ajouter un OwnerBot')
            .addUserOption(o => o.setName('user').setDescription('Utilisateur à ajouter').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Retirer un OwnerBot')
            .addUserOption(o => o.setName('user').setDescription('Utilisateur à retirer').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('Voir la liste des OwnerBots')),

    // Gestion des utilisateurs +create
    new SlashCommandBuilder()
        .setName('createusers')
        .setDescription('[OwnerBot] Gérer les utilisateurs autorisés à utiliser +create')
        .addSubcommand(s => s.setName('add').setDescription('Autoriser un utilisateur')
            .addUserOption(o => o.setName('user').setDescription('Utilisateur à autoriser').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Retirer un utilisateur autorisé')
            .addUserOption(o => o.setName('user').setDescription('Utilisateur à retirer').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('Voir la liste des utilisateurs +create')),

    // Aide & infos
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Voir toutes les commandes disponibles'),

    new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Informations et statistiques du bot'),

].map(c => c.toJSON());

async function deployCommands() {
    if (!CLIENT_ID) {
        console.warn('[COMMANDS] ⚠️ CLIENT_ID manquant — commandes slash non déployées.');
        return;
    }
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        console.log('[COMMANDS] Déploiement des commandes slash...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: SLASH_COMMANDS });
        console.log('[COMMANDS] ✅ Commandes déployées avec succès !');
    } catch (e) {
        console.error('[COMMANDS] ❌ Erreur déploiement:', e.message);
    }
}

// ──────────────────────────────────────────────────────────────
//  UTILITAIRES
// ──────────────────────────────────────────────────────────────
const isOwner    = id => db.ownerBots.includes(String(id));
const canCreate  = id => isOwner(id) || db.createUsers.includes(String(id));
const sleep      = ms => new Promise(r => setTimeout(r, ms));

function makeEmbed(color, title, description, fields = []) {
    const e = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: '🤖 Bot Manager' });
    if (fields.length) e.addFields(fields);
    return e;
}

function noPermEmbed() {
    return makeEmbed('#FF0000', '❌ Accès Refusé',
        '> Tu n\'es pas **OwnerBot** !\n> Demande l\'accès à un OwnerBot existant.');
}

function fmtUptime(s) {
    const d = Math.floor(s / 86400),
          h = Math.floor(s % 86400 / 3600),
          m = Math.floor(s % 3600 / 60),
          sc = Math.floor(s % 60);
    return [d && `${d}j`, h && `${h}h`, m && `${m}m`, `${sc}s`].filter(Boolean).join(' ');
}

// ──────────────────────────────────────────────────────────────
//  ÉVÉNEMENT READY
// ──────────────────────────────────────────────────────────────
client.once('ready', async () => {
    const totalMembers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);

    console.log(`\n╔════════════════════════════════════╗`);
    console.log(`║  ✅ Bot connecté : ${client.user.tag}`);
    console.log(`║  📊 Serveurs    : ${client.guilds.cache.size}`);
    console.log(`║  👥 Membres     : ${totalMembers}`);
    console.log(`║  🏓 Ping        : ${client.ws.ping}ms`);
    console.log(`╚════════════════════════════════════╝\n`);

    client.user.setActivity('🤖 /help | Bot Manager', { type: ActivityType.Watching });

    await deployCommands();
});

// ──────────────────────────────────────────────────────────────
//  AUTO-RÔLE À L'ARRIVÉE D'UN MEMBRE
// ──────────────────────────────────────────────────────────────
client.on('guildMemberAdd', async member => {
    try {
        const g = guildDB(member.guild.id);
        if (!g.autoRole) return;

        const role = member.guild.roles.cache.get(g.autoRole);
        if (!role) {
            // Le rôle a été supprimé — on nettoie
            g.autoRole = null;
            saveData(db);
            return;
        }

        await member.roles.add(role);
        console.log(`[AUTO-ROLE] ✅ "${role.name}" → ${member.user.tag} @ ${member.guild.name}`);
    } catch (e) {
        console.error('[AUTO-ROLE] ❌ Erreur:', e.message);
    }
});

// ──────────────────────────────────────────────────────────────
//  GESTIONNAIRE DES COMMANDES SLASH
// ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName: cmd, user, guild, guildId } = interaction;

    // ─── Commandes publiques ───────────────────────────────────

    if (cmd === 'help') {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📚 Bot Manager — Aide Complète')
                .addFields(
                    {
                        name: '👑 Commandes OwnerBot uniquement',
                        value: [
                            '`/setautorole <role>` — Rôle auto pour nouveaux membres',
                            '`/removeautorole` — Désactiver l\'auto-rôle',
                            '`/autoroleinfo` — Voir l\'auto-rôle configuré',
                            '`/rolecount <role>` — Compter les membres avec un rôle',
                            '`/massiveroles <role>` — Attribuer un rôle à tous',
                            '`/unmassiveroles <role>` — Retirer un rôle de tous',
                            '`/ownerbot add/remove/list` — Gérer les OwnerBots',
                            '`/createusers add/remove/list` — Gérer les utilisateurs +create',
                        ].join('\n')
                    },
                    {
                        name: '🎨 Commandes +create (utilisateurs configurables)',
                        value: [
                            '`+create <emoji>` — Créer un rôle avec cet emoji',
                            '`+create 🎮` — Emoji unicode',
                            '`+create <:nom:id>` — Emoji d\'un autre serveur',
                            '`+help` — Aide des commandes préfixées',
                        ].join('\n')
                    },
                    {
                        name: '🌐 Infos',
                        value: [
                            '`/botinfo` — Statistiques du bot',
                            '`/help` — Afficher cette aide',
                        ].join('\n')
                    }
                )
                .setFooter({ text: 'OwnerBot ID requis pour les commandes de gestion' })
                .setTimestamp()
            ],
            ephemeral: true
        });
    }

    if (cmd === 'botinfo') {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🤖 Bot Manager — Informations')
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { name: '🏷️ Tag', value: client.user.tag, inline: true },
                    { name: '📊 Serveurs', value: String(client.guilds.cache.size), inline: true },
                    { name: '🏓 Ping', value: `${client.ws.ping}ms`, inline: true },
                    { name: '⏱️ Uptime', value: fmtUptime(process.uptime()), inline: true },
                    { name: '👑 OwnerBots', value: String(db.ownerBots.length), inline: true },
                    { name: '✏️ Utilisateurs +create', value: String(db.createUsers.length), inline: true },
                    { name: '💾 Données sauvegardées', value: fs.existsSync(DATA_PATH) ? '✅ Oui' : '❌ Non', inline: true },
                    { name: '🌐 URL Keep-Alive', value: KEEP_ALIVE_URL, inline: false },
                )
                .setTimestamp()
                .setFooter({ text: '🤖 Bot Manager' })
            ],
            ephemeral: true
        });
    }

    // ─── Toutes les autres commandes → OwnerBot requis ────────

    if (!isOwner(user.id)) {
        return interaction.reply({ embeds: [noPermEmbed()], ephemeral: true });
    }

    const g = guildId ? guildDB(guildId) : null;

    // ── /setautorole ──────────────────────────────────────────
    if (cmd === 'setautorole') {
        const role = interaction.options.getRole('role');
        g.autoRole = role.id;
        saveData(db);
        return interaction.reply({
            embeds: [makeEmbed('#00FF7F', '✅ Auto-Rôle Configuré',
                `Le rôle <@&${role.id}> (**${role.name}**) sera automatiquement attribué à chaque nouveau membre.`
            )]
        });
    }

    // ── /removeautorole ───────────────────────────────────────
    if (cmd === 'removeautorole') {
        if (!g.autoRole) {
            return interaction.reply({
                embeds: [makeEmbed('#FFFF00', '⚠️ Aucun Auto-Rôle', 'Il n\'y a pas d\'auto-rôle configuré sur ce serveur.')],
                ephemeral: true
            });
        }
        g.autoRole = null;
        saveData(db);
        return interaction.reply({
            embeds: [makeEmbed('#FF6600', '✅ Auto-Rôle Supprimé',
                'L\'auto-rôle est désactivé. Les nouveaux membres ne recevront plus de rôle automatiquement.'
            )]
        });
    }

    // ── /autoroleinfo ─────────────────────────────────────────
    if (cmd === 'autoroleinfo') {
        if (!g.autoRole) {
            return interaction.reply({
                embeds: [makeEmbed('#FFFF00', '⚠️ Auto-Rôle', 'Aucun auto-rôle n\'est configuré pour ce serveur.')],
                ephemeral: true
            });
        }
        const role = guild.roles.cache.get(g.autoRole);
        if (!role) {
            g.autoRole = null; saveData(db);
            return interaction.reply({
                embeds: [makeEmbed('#FF0000', '❌ Rôle Introuvable', 'L\'auto-rôle configuré n\'existe plus. Il a été réinitialisé.')],
                ephemeral: true
            });
        }
        return interaction.reply({
            embeds: [makeEmbed('#5865F2', '📋 Auto-Rôle Actuel',
                `**Rôle:** <@&${role.id}>\n**Nom:** ${role.name}\n**ID:** \`${role.id}\``
            )],
            ephemeral: true
        });
    }

    // ── /rolecount ────────────────────────────────────────────
    if (cmd === 'rolecount') {
        const role = interaction.options.getRole('role');
        await interaction.deferReply();
        try {
            await guild.members.fetch();
            const count = role.members.size;
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(role.color || '#5865F2')
                    .setTitle('📊 Comptage de Rôle')
                    .setDescription(`**${count}** membre(s) possèdent ce rôle.`)
                    .addFields(
                        { name: '🎭 Rôle', value: `<@&${role.id}>`, inline: true },
                        { name: '👥 Membres', value: `**${count}**`, inline: true },
                        { name: '🔑 ID', value: `\`${role.id}\``, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: '🤖 Bot Manager' })
                ]
            });
        } catch (e) {
            console.error('[rolecount] Erreur:', e.message);
            return interaction.editReply({ content: '❌ Erreur lors du comptage des membres.' });
        }
    }

    // ── /massiveroles ─────────────────────────────────────────
    if (cmd === 'massiveroles') {
        const role = interaction.options.getRole('role');
        await interaction.deferReply();

        let members;
        try {
            members = await guild.members.fetch();
        } catch (e) {
            return interaction.editReply({ content: '❌ Impossible de récupérer les membres du serveur.' });
        }

        const humans = [...members.values()].filter(m => !m.user.bot);
        const total = humans.length;
        let success = 0, skipped = 0, failed = 0, processed = 0;

        console.log(`[MASSIVEROLES] Démarrage: ${total} membres, rôle "${role.name}"`);

        // Mise à jour de la progression toutes les 5 secondes
        const progressInterval = setInterval(async () => {
            try {
                await interaction.editReply({
                    embeds: [makeEmbed('#FFA500', '⏳ Massive Roles en cours...',
                        `**Progression: ${processed}/${total} membres**\n\n✅ Attribués: **${success}**\n⏭️ Déjà présents: **${skipped}**\n❌ Erreurs: **${failed}**`
                    )]
                });
            } catch {}
        }, 5000);

        for (const member of humans) {
            if (member.roles.cache.has(role.id)) {
                skipped++; processed++;
                continue;
            }
            try {
                await member.roles.add(role);
                success++;
            } catch {
                failed++;
            }
            processed++;
            await sleep(800); // Anti rate-limit
        }

        clearInterval(progressInterval);
        console.log(`[MASSIVEROLES] ✅ Terminé: ${success} succès, ${skipped} sautés, ${failed} erreurs`);

        return interaction.editReply({
            embeds: [makeEmbed('#00FF7F', '✅ Massive Roles Terminé',
                `Rôle **${role.name}** traité pour **${total}** membres.`,
                [
                    { name: '✅ Attribués', value: `**${success}**`, inline: true },
                    { name: '⏭️ Déjà présents', value: `**${skipped}**`, inline: true },
                    { name: '❌ Erreurs', value: `**${failed}**`, inline: true },
                ]
            )]
        });
    }

    // ── /unmassiveroles ───────────────────────────────────────
    if (cmd === 'unmassiveroles') {
        const role = interaction.options.getRole('role');
        await interaction.deferReply();

        try {
            await guild.members.fetch();
        } catch {}

        const withRole = [...role.members.values()];
        const total = withRole.length;
        let success = 0, failed = 0, processed = 0;

        if (total === 0) {
            return interaction.editReply({
                embeds: [makeEmbed('#FFFF00', '⚠️ UnMassive Roles',
                    `Aucun membre ne possède le rôle **${role.name}**.`
                )]
            });
        }

        console.log(`[UNMASSIVEROLES] Démarrage: ${total} membres, rôle "${role.name}"`);

        const progressInterval = setInterval(async () => {
            try {
                await interaction.editReply({
                    embeds: [makeEmbed('#FFA500', '⏳ UnMassive Roles en cours...',
                        `**Progression: ${processed}/${total} membres**\n\n✅ Retirés: **${success}**\n❌ Erreurs: **${failed}**`
                    )]
                });
            } catch {}
        }, 5000);

        for (const member of withRole) {
            try {
                await member.roles.remove(role);
                success++;
            } catch {
                failed++;
            }
            processed++;
            await sleep(800);
        }

        clearInterval(progressInterval);
        console.log(`[UNMASSIVEROLES] ✅ Terminé: ${success} retirés, ${failed} erreurs`);

        return interaction.editReply({
            embeds: [makeEmbed('#FF6600', '✅ UnMassive Roles Terminé',
                `Rôle **${role.name}** retiré de **${total}** membres.`,
                [
                    { name: '✅ Retirés', value: `**${success}**`, inline: true },
                    { name: '❌ Erreurs', value: `**${failed}**`, inline: true },
                ]
            )]
        });
    }

    // ── /ownerbot ─────────────────────────────────────────────
    if (cmd === 'ownerbot') {
        const sub    = interaction.options.getSubcommand();
        const target = sub !== 'list' ? interaction.options.getUser('user') : null;

        if (sub === 'add') {
            if (db.ownerBots.includes(target.id)) {
                return interaction.reply({
                    embeds: [makeEmbed('#FFFF00', '⚠️ Déjà OwnerBot', `**${target.tag}** est déjà OwnerBot !`)],
                    ephemeral: true
                });
            }
            db.ownerBots.push(target.id);
            saveData(db);
            console.log(`[OWNERBOT] ✅ Ajouté: ${target.tag} (${target.id})`);
            return interaction.reply({
                embeds: [makeEmbed('#00FF7F', '✅ OwnerBot Ajouté',
                    `**${target.tag}** est maintenant OwnerBot!\n\`ID: ${target.id}\``
                )]
            });
        }

        if (sub === 'remove') {
            const i = db.ownerBots.indexOf(target.id);
            if (i === -1) {
                return interaction.reply({
                    embeds: [makeEmbed('#FFFF00', '⚠️ Pas OwnerBot', `**${target.tag}** n'est pas OwnerBot !`)],
                    ephemeral: true
                });
            }
            db.ownerBots.splice(i, 1);
            saveData(db);
            console.log(`[OWNERBOT] ✅ Retiré: ${target.tag} (${target.id})`);
            return interaction.reply({
                embeds: [makeEmbed('#FF0000', '✅ OwnerBot Retiré',
                    `**${target.tag}** n'est plus OwnerBot.\n\`ID: ${target.id}\``
                )]
            });
        }

        if (sub === 'list') {
            const list = db.ownerBots.length > 0
                ? db.ownerBots.map((id, i) => `**${i+1}.** <@${id}> — \`${id}\``).join('\n')
                : '*Aucun OwnerBot configuré.*';
            return interaction.reply({
                embeds: [makeEmbed('#5865F2', `👑 OwnerBots (${db.ownerBots.length})`, list)],
                ephemeral: true
            });
        }
    }

    // ── /createusers ──────────────────────────────────────────
    if (cmd === 'createusers') {
        const sub    = interaction.options.getSubcommand();
        const target = sub !== 'list' ? interaction.options.getUser('user') : null;

        if (sub === 'add') {
            if (db.createUsers.includes(target.id)) {
                return interaction.reply({
                    embeds: [makeEmbed('#FFFF00', '⚠️ Déjà autorisé', `**${target.tag}** est déjà autorisé à utiliser +create !`)],
                    ephemeral: true
                });
            }
            db.createUsers.push(target.id);
            saveData(db);
            console.log(`[CREATEUSERS] ✅ Ajouté: ${target.tag} (${target.id})`);
            return interaction.reply({
                embeds: [makeEmbed('#00FF7F', '✅ Utilisateur +create Ajouté',
                    `**${target.tag}** peut maintenant utiliser **+create** !\n\`ID: ${target.id}\``
                )]
            });
        }

        if (sub === 'remove') {
            const i = db.createUsers.indexOf(target.id);
            if (i === -1) {
                return interaction.reply({
                    embeds: [makeEmbed('#FFFF00', '⚠️ Pas dans la liste', `**${target.tag}** n'est pas dans la liste +create !`)],
                    ephemeral: true
                });
            }
            db.createUsers.splice(i, 1);
            saveData(db);
            console.log(`[CREATEUSERS] ✅ Retiré: ${target.tag} (${target.id})`);
            return interaction.reply({
                embeds: [makeEmbed('#FF0000', '✅ Utilisateur +create Retiré',
                    `**${target.tag}** ne peut plus utiliser +create.\n\`ID: ${target.id}\``
                )]
            });
        }

        if (sub === 'list') {
            const list = db.createUsers.length > 0
                ? db.createUsers.map((id, i) => `**${i+1}.** <@${id}> — \`${id}\``).join('\n')
                : '*Aucun utilisateur autorisé.*';
            return interaction.reply({
                embeds: [makeEmbed('#5865F2', `📋 Utilisateurs +create (${db.createUsers.length})`, list)],
                ephemeral: true
            });
        }
    }
});

// ──────────────────────────────────────────────────────────────
//  GESTIONNAIRE DES COMMANDES PRÉFIXÉES (+create, +help)
// ──────────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/g);
    const cmd  = args.shift().toLowerCase();

    // ── +help ─────────────────────────────────────────────────
    if (cmd === 'help') {
        return message.reply({
            embeds: [makeEmbed('#5865F2', '📚 Aide — Commandes +', [
                '`+create <emoji>` — Créer un rôle avec l\'emoji donné',
                '',
                '**Exemples:**',
                '`+create 🎮` → rôle avec un emoji unicode',
                '`+create <:nomEmoji:123456789>` → rôle avec un emoji d\'un autre serveur',
                '`+create <a:animEmoji:123456789>` → rôle avec un emoji animé',
                '',
                '> L\'accès à +create est géré par les OwnerBots via `/createusers`',
            ].join('\n'))]
        });
    }

    // ── +create ───────────────────────────────────────────────
    if (cmd === 'create') {
        // Vérification des permissions
        if (!canCreate(message.author.id)) {
            return message.reply({
                embeds: [makeEmbed('#FF0000', '❌ Accès Refusé',
                    '> Tu n\'es pas autorisé à utiliser **+create**.\n> Demande l\'accès à un OwnerBot via `/createusers add @toi`'
                )]
            });
        }

        if (!args[0]) {
            return message.reply({
                embeds: [makeEmbed('#FFFF00', '⚠️ Usage de +create', [
                    '`+create <emoji>`',
                    '',
                    '**Exemples:**',
                    '`+create 🎮` — Emoji unicode',
                    '`+create <:monEmoji:123456789>` — Emoji d\'un autre serveur',
                    '`+create <a:animEmoji:123456789>` — Emoji animé',
                ].join('\n'))]
            });
        }

        const raw = args.join(' ').trim();

        // Parsing de l'emoji
        const animMatch = raw.match(/<a:([^:]+):(\d+)>/);
        const statMatch = raw.match(/<:([^:]+):(\d+)>/);

        let roleName, emojiIconUrl = null, displayEmoji = raw;

        if (animMatch || statMatch) {
            const m = animMatch || statMatch;
            roleName     = m[1];
            const emojiId = m[2];
            const ext     = animMatch ? 'gif' : 'png';
            emojiIconUrl  = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`;
        } else {
            // Emoji unicode — on l'utilise directement comme nom
            roleName = raw.slice(0, 100);
        }

        // Sécurité: nom de rôle valide
        roleName = (roleName || 'Nouveau Rôle').replace(/[^\w\s\-_\u00C0-\u024F\u1E00-\u1EFF\p{Emoji}]/gu, '').trim().slice(0, 100) || 'Nouveau Rôle';

        try {
            const roleOptions = {
                name:   roleName,
                color:  '#5865F2',
                reason: `+create par ${message.author.tag} (${message.author.id})`
            };

            let role;

            // Tentative avec icône (nécessite Boost Level 2+)
            if (emojiIconUrl) {
                try {
                    role = await message.guild.roles.create({ ...roleOptions, icon: emojiIconUrl });
                } catch {
                    // Boost insuffisant — création sans icône
                    role = await message.guild.roles.create(roleOptions);
                }
            } else {
                role = await message.guild.roles.create(roleOptions);
            }

            console.log(`[+CREATE] ✅ "${role.name}" créé par ${message.author.tag} @ ${message.guild.name}`);

            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor(role.color || '#5865F2')
                    .setTitle('✅ Rôle Créé avec Succès !')
                    .addFields(
                        { name: '🎭 Rôle',    value: `<@&${role.id}>`,      inline: true },
                        { name: '🔑 ID',      value: `\`${role.id}\``,      inline: true },
                        { name: '😀 Emoji',   value: displayEmoji.slice(0, 100), inline: true }
                    )
                    .setFooter({ text: `Créé par ${message.author.tag}` })
                    .setTimestamp()
                ]
            });

        } catch (e) {
            console.error('[+CREATE] ❌ Erreur:', e.message);
            let desc = `❌ Erreur: ${e.message}`;
            if (e.code === 50013) desc = '❌ Je n\'ai pas la permission de créer des rôles !';
            else if (e.code === 30005) desc = '❌ Le serveur a atteint la limite de 250 rôles !';
            return message.reply({ embeds: [makeEmbed('#FF0000', '❌ Erreur +create', desc)] });
        }
    }
});

// ──────────────────────────────────────────────────────────────
//  GESTION DES ERREURS — ANTI-CRASH COMPLET
// ──────────────────────────────────────────────────────────────
process.on('uncaughtException', err => {
    console.error('[CRASH] uncaughtException :', err.message);
    console.error(err.stack);
    // On ne quitte PAS le process — le bot continue
});

process.on('unhandledRejection', (reason) => {
    console.error('[CRASH] unhandledRejection :', reason);
});

client.on('error',   err => console.error('[DISCORD] Client error:', err.message));
client.on('warn',    msg => console.warn('[DISCORD] Warning:', msg));
client.on('debug',   () => {}); // Silence les debug verbeux

client.on('shardDisconnect', (event, shardId) => {
    console.warn(`[SHARD] Shard ${shardId} déconnecté (code: ${event.code}) — reconnexion auto...`);
});

client.on('shardReconnecting', shardId => {
    console.log(`[SHARD] Shard ${shardId} reconnexion en cours...`);
});

client.on('shardResume', shardId => {
    console.log(`[SHARD] ✅ Shard ${shardId} reconnecté !`);
    // Reprend exactement là où le bot s'était arrêté (persistance via bot_data.json)
    client.user?.setActivity('🤖 /help | Bot Manager', { type: ActivityType.Watching });
});

// ──────────────────────────────────────────────────────────────
//  CONNEXION AVEC RETRY PROGRESSIF
// ──────────────────────────────────────────────────────────────
let loginRetries = 0;

async function login() {
    try {
        console.log(`[LOGIN] Tentative ${loginRetries + 1}...`);
        await client.login(TOKEN);
        loginRetries = 0;
    } catch (e) {
        loginRetries++;
        const delay = Math.min(loginRetries * 5_000, 60_000); // Max 60s
        console.error(`[LOGIN] ❌ Erreur: ${e.message}`);
        console.log(`[LOGIN] Prochaine tentative dans ${delay / 1000}s...`);
        setTimeout(login, delay);
    }
}

// ──────────────────────────────────────────────────────────────
//  DÉMARRAGE
// ──────────────────────────────────────────────────────────────
login();
