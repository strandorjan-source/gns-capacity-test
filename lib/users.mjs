import { isAdmin, withTimeout } from './capacity.mjs';

/** UI permission only; RLS and the database trigger enforce the same rules. */
export function canRemoveCapacityProfile(actor, target) {
  return Boolean(isAdmin(actor) && !actor.deleted_at && actor.user_id && target?.user_id
    && actor.user_id !== target.user_id && target.approved === false && !target.deleted_at);
}

export function visibleCapacityProfiles(profiles = []) {
  return profiles.filter(profile => !profile.deleted_at);
}

export async function removeCapacityProfile(client, actor, target) {
  if (!canRemoveCapacityProfile(actor, target)) {
    throw new Error('Bare admin kan slette andre brukere uten tilgang.');
  }
  // A timestamp requests removal; the database supplies the real time and actor.
  // Keep the profile as a tombstone so login cannot recreate a pending request.
  const { data, error } = await withTimeout(client.from('capacity_profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', target.user_id).eq('approved', false).is('deleted_at', null)
    .select('user_id').maybeSingle());
  if (error) throw error;
  if (!data) throw new Error('Brukeren er allerede slettet eller har fått tilgang. Oppdater oversikten.');
  return data.user_id;
}
