import { PermissionFlagsBits } from 'discord.js';
import { readSnowflake } from '../src/config.js';

try {
  const clientId = readSnowflake(process.env.DISCORD_CLIENT_ID, 'DISCORD_CLIENT_ID');
  const permissions = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages
    | PermissionFlagsBits.SendMessagesInThreads | PermissionFlagsBits.EmbedLinks
    | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.SendPolls
    | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, scope: 'bot applications.commands', permissions: String(permissions), integration_type: '0' });
  console.log(url.href);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
