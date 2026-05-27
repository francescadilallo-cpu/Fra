"""
Mapping configuration: ERP table fields → Ontology concepts.
Supports in-memory updates (persisted per process lifetime).
"""

from __future__ import annotations

import copy
from typing import Any

# ── Default mapping ────────────────────────────────────────────────────────────

_DEFAULT_MAPPINGS: dict[str, dict[str, dict[str, str]]] = {
    "customers": {
        "id": {
            "ontology_class": "Customer",
            "ontology_property": "identifier",
            "type": "integer",
        },
        "name": {
            "ontology_class": "Customer",
            "ontology_property": "name",
            "type": "string",
        },
        "sector": {
            "ontology_class": "Customer",
            "ontology_property": "sector",
            "type": "string",
        },
        "country": {
            "ontology_class": "Customer",
            "ontology_property": "country",
            "type": "string",
        },
        "vat_number": {
            "ontology_class": "Customer",
            "ontology_property": "vatNumber",
            "type": "string",
        },
        "credit_limit": {
            "ontology_class": "Customer",
            "ontology_property": "creditLimit",
            "type": "decimal",
        },
    },
    "products": {
        "id": {
            "ontology_class": "Product",
            "ontology_property": "identifier",
            "type": "integer",
        },
        "sku": {
            "ontology_class": "Product",
            "ontology_property": "sku",
            "type": "string",
        },
        "name": {
            "ontology_class": "Product",
            "ontology_property": "name",
            "type": "string",
        },
        "category": {
            "ontology_class": "Product",
            "ontology_property": "category",
            "type": "string",
        },
        "unit_price": {
            "ontology_class": "Product",
            "ontology_property": "unitPrice",
            "type": "decimal",
        },
        "unit_of_measure": {
            "ontology_class": "Product",
            "ontology_property": "unitOfMeasure",
            "type": "string",
        },
    },
    "quotes": {
        "id": {
            "ontology_class": "Quote",
            "ontology_property": "identifier",
            "type": "integer",
        },
        "customer_id": {
            "ontology_class": "Quote",
            "ontology_property": "hasCustomer",
            "type": "objectProperty",
        },
        "date": {
            "ontology_class": "Quote",
            "ontology_property": "date",
            "type": "date",
        },
        "status": {
            "ontology_class": "Quote",
            "ontology_property": "status",
            "type": "string",
        },
        "total_value": {
            "ontology_class": "Quote",
            "ontology_property": "totalValue",
            "type": "decimal",
        },
        "valid_until": {
            "ontology_class": "Quote",
            "ontology_property": "validUntil",
            "type": "date",
        },
        "created_by": {
            "ontology_class": "Quote",
            "ontology_property": "createdBy",
            "type": "string",
        },
    },
    "quote_lines": {
        "id": {
            "ontology_class": "QuoteLineItem",
            "ontology_property": "identifier",
            "type": "integer",
        },
        "quote_id": {
            "ontology_class": "QuoteLineItem",
            "ontology_property": "hasQuote",
            "type": "objectProperty",
        },
        "product_id": {
            "ontology_class": "QuoteLineItem",
            "ontology_property": "hasProduct",
            "type": "objectProperty",
        },
        "quantity": {
            "ontology_class": "QuoteLineItem",
            "ontology_property": "quantity",
            "type": "decimal",
        },
        "unit_price": {
            "ontology_class": "QuoteLineItem",
            "ontology_property": "unitPrice",
            "type": "decimal",
        },
        "discount_pct": {
            "ontology_class": "QuoteLineItem",
            "ontology_property": "discountPct",
            "type": "decimal",
        },
        "line_total": {
            "ontology_class": "QuoteLineItem",
            "ontology_property": "lineTotal",
            "type": "decimal",
        },
    },
    "orders": {
        "id": {
            "ontology_class": "Order",
            "ontology_property": "identifier",
            "type": "integer",
        },
        "quote_id": {
            "ontology_class": "Order",
            "ontology_property": "relatedToQuote",
            "type": "objectProperty",
        },
        "customer_id": {
            "ontology_class": "Order",
            "ontology_property": "orderedBy",
            "type": "objectProperty",
        },
        "date": {
            "ontology_class": "Order",
            "ontology_property": "date",
            "type": "date",
        },
        "status": {
            "ontology_class": "Order",
            "ontology_property": "status",
            "type": "string",
        },
        "delivery_date": {
            "ontology_class": "Order",
            "ontology_property": "deliveryDate",
            "type": "date",
        },
        "total_value": {
            "ontology_class": "Order",
            "ontology_property": "totalValue",
            "type": "decimal",
        },
    },
    "order_lines": {
        "id": {
            "ontology_class": "OrderLineItem",
            "ontology_property": "identifier",
            "type": "integer",
        },
        "order_id": {
            "ontology_class": "OrderLineItem",
            "ontology_property": "hasOrder",
            "type": "objectProperty",
        },
        "product_id": {
            "ontology_class": "OrderLineItem",
            "ontology_property": "hasProduct",
            "type": "objectProperty",
        },
        "quantity": {
            "ontology_class": "OrderLineItem",
            "ontology_property": "quantity",
            "type": "decimal",
        },
        "unit_price": {
            "ontology_class": "OrderLineItem",
            "ontology_property": "unitPrice",
            "type": "decimal",
        },
        "line_total": {
            "ontology_class": "OrderLineItem",
            "ontology_property": "lineTotal",
            "type": "decimal",
        },
    },
}

# Mutable runtime copy
_mappings: dict[str, dict[str, dict[str, str]]] = copy.deepcopy(_DEFAULT_MAPPINGS)


# ── Public API ─────────────────────────────────────────────────────────────────


def get_mappings() -> dict[str, Any]:
    """Return the full mapping configuration."""
    return copy.deepcopy(_mappings)


def get_flat_mappings() -> list[dict[str, str]]:
    """Return a flat list suitable for the frontend table."""
    rows: list[dict[str, str]] = []
    for table, fields in _mappings.items():
        for field, meta in fields.items():
            rows.append(
                {
                    "table": table,
                    "field": field,
                    "ontology_class": meta["ontology_class"],
                    "ontology_property": meta["ontology_property"],
                    "field_type": meta["type"],
                }
            )
    return rows


def update_mapping(table: str, field: str, ontology_path: str) -> bool:
    """
    Update the ontology mapping for a specific table.field.
    ontology_path format: "ClassName.propertyName"
    Returns True on success, False if table/field not found.
    """
    if table not in _mappings:
        return False
    if field not in _mappings[table]:
        return False

    parts = ontology_path.split(".", 1)
    if len(parts) == 2:
        _mappings[table][field]["ontology_class"] = parts[0]
        _mappings[table][field]["ontology_property"] = parts[1]
    else:
        _mappings[table][field]["ontology_property"] = ontology_path

    return True
