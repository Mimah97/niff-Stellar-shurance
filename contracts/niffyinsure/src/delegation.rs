/// Admin role delegation: temporary operator grants with expiry (Issue #585).
///
/// Allows the admin to grant temporary operator roles with specific permissions
/// and an expiry ledger. Delegated operators can only perform permitted operations.
use soroban_sdk::{contractevent, Address, Env};

use crate::{
    storage,
    types::{DelegationPermissions, DelegationRecord},
    validate::Error,
};

#[contractevent(topics = ["niffyinsure", "delegation_granted"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationGranted {
    #[topic]
    pub operator: Address,
    pub grantor: Address,
    pub expiry_ledger: u32,
    pub permissions: DelegationPermissions,
}

#[contractevent(topics = ["niffyinsure", "delegation_revoked"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationRevoked {
    #[topic]
    pub operator: Address,
    pub revoked_by: Address,
    pub at_ledger: u32,
}

/// Admin-only: grant a temporary delegation to `operator`.
pub fn grant_delegation(
    env: &Env,
    admin: &Address,
    operator: &Address,
    expiry_ledger: u32,
    permissions: DelegationPermissions,
) -> Result<(), Error> {
    let now = env.ledger().sequence();
    if expiry_ledger <= now {
        return Err(Error::DelegationInvalid);
    }

    let record = DelegationRecord {
        grantor: admin.clone(),
        expiry_ledger,
        permissions: permissions.clone(),
    };

    storage::set_delegation(env, operator, &record);

    DelegationGranted {
        operator: operator.clone(),
        grantor: admin.clone(),
        expiry_ledger,
        permissions,
    }
    .publish(env);

    Ok(())
}

/// Admin-only: revoke a delegation before it expires.
pub fn revoke_delegation(env: &Env, admin: &Address, operator: &Address) {
    storage::remove_delegation(env, operator);

    DelegationRevoked {
        operator: operator.clone(),
        revoked_by: admin.clone(),
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);
}

/// Check if `operator` has a valid (non-expired) delegation.
pub fn get_delegation(env: &Env, operator: &Address) -> Option<DelegationRecord> {
    let record = storage::get_delegation(env, operator)?;
    let now = env.ledger().sequence();
    if now > record.expiry_ledger {
        return None;
    }
    Some(record)
}
