"""Default glossary terms for ERP/CRM deployments.

Seeded as Context Documents on first startup so they are user-editable.
"""

DEFAULT_GLOSSARY: dict[str, str] = {
    "cliente attivo": (
        "An 'active customer' is a CRM account with isActive=1 and accountId > 0 "
        "(accountId < 0 indicates a duplicate excluded from the clean model). "
        "Can be B2B or B2C."
    ),
    "fatturato": (
        "'Fatturato' is an ambiguous term in the system: it can refer to "
        "revenue (SUM subtotal_amount, ~$20M) or revenue_with_tax "
        "(SUM total_due, ~$22.4M which includes taxes and shipping). "
        "Please specify which definition to use."
    ),
    "revenue": (
        "revenue = SUM(subtotal_amount) — pure revenue without taxes or shipping (~$20M). "
        "Values in USD ($)."
    ),
    "revenue_with_tax": (
        "revenue_with_tax = SUM(total_due) — gross revenue including taxes and shipping (~$22.4M). "
        "Values in USD ($)."
    ),
    "margin": (
        "margin = SUM(qty * (listPrice - standardCost)) — gross margin per product. "
        "Calculated cross-ERP+PIM. Values in USD ($)."
    ),
    "active_customers": (
        "active_customers = COUNT(DISTINCT accountId) WHERE accountId > 0 AND isActive=1. "
        "Duplicates (accountId < 0) are excluded by the deduplication Rule."
    ),
    "duplicato": (
        "A 'duplicate' is a CRM record with accountId < 0. "
        "The disambiguation Rule automatically excludes these records from all metrics."
    ),
    "accountid": (
        "accountId > 0 = valid customer record; "
        "accountId < 0 = CRM duplicate (excluded from the clean model by the deduplication Rule)."
    ),
    "make only": (
        "'Make Only' product (isMakeOnly=true in PIM): product manufactured internally, "
        "not purchased from external suppliers."
    ),
    "hr": (
        "HR/PIM is the data source for employees and product catalog. "
        "Sync status is 'Delayed': data may not be updated in real time."
    ),
}
