import Resolver from '@forge/resolver';

const resolver = new Resolver();

// One resolver function serves both the project page and the issue panel.
resolver.define('getStatus', () => {
  console.log('[TG] stub resolver');
  return { stub: true, name: 'resolver' };
});

export const handler = resolver.getDefinitions();
