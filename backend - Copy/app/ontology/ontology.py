"""Business ontology: Pydantic v2 models + YAML loader + RDF export.

Entities
--------
Customer (B2C / B2B via account_type)
Employee
Salesperson  (sub-role of Employee)
Product
SalesOrder
SalesOrderLine
Territory
Address
Offer
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

logger = logging.getLogger(__name__)


# ── Base entity model ─────────────────────────────────────────────────────────

class OntologyEntity(BaseModel):
    """Common base for all business entities."""

    model_config = {"extra": "allow"}


# ── Concrete entity models ────────────────────────────────────────────────────

class Address(OntologyEntity):
    address_id: int | None = None
    line1: str | None = None
    line2: str | None = None
    city: str | None = None
    state_province_id: int | None = None
    postal_code: str | None = None


class Territory(OntologyEntity):
    territory_id: int | None = None
    territory_name: str | None = None
    country_code: str | None = None
    region_group: str | None = None
    sales_ytd: float | None = None
    cost_ytd: float | None = None


class Customer(OntologyEntity):
    customer_id: int | None = None
    account_type: Literal["B2C", "B2B"] | None = None
    display_name: str | None = None          # ragioneSociale (B2B) or nomeContatto (B2C)
    email: str | None = None
    phone: str | None = None
    territory_hint: str | None = None
    is_active: bool | None = None
    # provenance
    _sources: list[dict] = []


class Employee(OntologyEntity):
    employee_id: int | None = None           # = MatricolaDip
    first_name: str | None = None
    last_name: str | None = None
    full_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    department_group: str | None = None
    hire_date: str | None = None             # ISO 8601
    birth_date: str | None = None            # ISO 8601
    gender: str | None = None
    marital_status: str | None = None
    vacation_hours: float | None = None
    sick_hours: float | None = None
    hourly_rate: float | None = None
    pay_frequency: int | None = None


class Salesperson(Employee):
    """A Salesperson is an Employee with additional commercial attributes."""

    territory_ref: int | None = None
    sales_quota: float | None = None
    bonus: float | None = None
    commission_pct: float | None = None
    sales_ytd: float | None = None
    sales_last_year: float | None = None


class Product(OntologyEntity):
    product_id: int | None = None            # = internal_id
    sku: str | None = None
    display_name: str | None = None
    category_path: str | None = None
    model_name: str | None = None
    color: str | None = None
    size: str | None = None
    weight: float | None = None
    weight_unit: str | None = None
    standard_cost: float | None = None
    list_price: float | None = None
    is_make_only: bool | None = None
    is_purchasable: bool | None = None
    sell_start_date: str | None = None       # ISO 8601
    sell_end_date: str | None = None         # ISO 8601


class SalesOrder(OntologyEntity):
    order_id: int | None = None
    order_number: str | None = None
    order_date: str | None = None
    ship_date: str | None = None
    due_date: str | None = None
    status_code: int | None = None
    customer_ref: int | None = None
    salesperson_ref: int | None = None
    territory_ref: int | None = None
    subtotal_amount: float | None = None
    tax_amount: float | None = None
    freight_amount: float | None = None
    total_due: float | None = None
    currency_iso: str | None = None


class SalesOrderLine(OntologyEntity):
    order_id: int | None = None
    line_id: int | None = None
    product_ref: int | None = None
    qty: int | None = None
    unit_price: float | None = None
    unit_discount: float | None = None
    line_total: float | None = None
    offer_ref: int | None = None


class Offer(OntologyEntity):
    offer_id: int | None = None
    description: str | None = None
    discount_pct: float | None = None
    offer_type: str | None = None
    category: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    min_qty: int | None = None
    max_qty: int | None = None


# ── Entity registry ───────────────────────────────────────────────────────────

_ENTITY_REGISTRY: dict[str, type[OntologyEntity]] = {
    "Customer": Customer,
    "Employee": Employee,
    "Salesperson": Salesperson,
    "Product": Product,
    "SalesOrder": SalesOrder,
    "SalesOrderLine": SalesOrderLine,
    "Territory": Territory,
    "Address": Address,
    "Offer": Offer,
}


# ── Ontology class ─────────────────────────────────────────────────────────────

class Ontology:
    """Loads the YAML ontology definition and provides access to entity schemas.

    The YAML defines source-to-entity field mappings, metrics, dimensions and
    known ambiguities.  The Pydantic models above define the canonical schema.
    """

    def __init__(self, yaml_data: dict[str, Any]) -> None:
        self._data = yaml_data
        self._entities_cfg: dict[str, Any] = yaml_data.get("entities", {})
        self._metrics_cfg: dict[str, Any] = yaml_data.get("metrics", {})
        self._dimensions_cfg: dict[str, Any] = yaml_data.get("dimensions", {})
        self._ambiguities: list[dict] = yaml_data.get("known_ambiguities", [])

    # ── class methods ────────────────────────────────────────────────────────

    @classmethod
    def load(cls, path: str | Path) -> "Ontology":
        """Load ontology from a YAML file."""
        p = Path(path)
        with p.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        logger.info("Ontology loaded from %s (version=%s)", p, data.get("ontology_version"))
        return cls(data)

    # ── entity access ────────────────────────────────────────────────────────

    def entity(self, name: str) -> type[OntologyEntity]:
        """Return the Pydantic model class for *name*.

        Raises KeyError if the entity is not in the registry.
        """
        if name not in _ENTITY_REGISTRY:
            raise KeyError(f"Unknown entity '{name}'. Known: {list(_ENTITY_REGISTRY)}")
        return _ENTITY_REGISTRY[name]

    def entity_names(self) -> list[str]:
        """Return all registered entity names."""
        return list(_ENTITY_REGISTRY.keys())

    def relations_of(self, entity: str) -> list[dict]:
        """Return relation definitions for *entity* as listed in the YAML.

        Each dict has keys: name, type (relation cardinality), target, via.
        """
        cfg = self._entities_cfg.get(entity, {})
        attrs = cfg.get("attributes", {})
        relations = []
        for attr_name, attr_cfg in attrs.items():
            if isinstance(attr_cfg, dict) and "relation" in attr_cfg:
                relations.append(
                    {
                        "name": attr_name,
                        "type": attr_cfg.get("relation"),
                        "target": attr_cfg.get("target"),
                        "via": attr_cfg.get("via"),
                    }
                )
        return relations

    def metric_names(self) -> list[str]:
        return list(self._metrics_cfg.keys())

    def metric(self, name: str) -> dict[str, Any]:
        return self._metrics_cfg[name]

    def dimension_names(self) -> list[str]:
        return list(self._dimensions_cfg.keys())

    def dimension(self, name: str) -> dict[str, Any]:
        return self._dimensions_cfg[name]

    def known_ambiguities(self) -> list[dict]:
        """Return the list of known ambiguous terms from the YAML."""
        return list(self._ambiguities)

    def entity_sources(self, entity: str) -> list[dict]:
        """Return the source definitions for *entity* as listed in the YAML."""
        cfg = self._entities_cfg.get(entity, {})
        return cfg.get("sources", [])

    def entity_description(self, entity: str) -> str:
        cfg = self._entities_cfg.get(entity, {})
        return cfg.get("description", "")

    def quality_flags(self, entity: str) -> dict[str, Any]:
        cfg = self._entities_cfg.get(entity, {})
        return cfg.get("quality_flags", {})

    # ── RDF export ────────────────────────────────────────────────────────────

    def to_rdf(self):  # -> rdflib.Graph
        """Export the ontology as an RDF graph (rdflib.Graph).

        Uses a simple custom namespace ``fra:`` for all classes and properties.
        """
        try:
            import rdflib
            from rdflib.namespace import OWL, RDF, RDFS
        except ImportError as exc:
            raise ImportError("rdflib is required for to_rdf(); install it.") from exc

        FRA = rdflib.Namespace("https://fra.example/ontology#")
        g = rdflib.Graph()
        g.bind("fra", FRA)

        for entity_name, model_cls in _ENTITY_REGISTRY.items():
            cls_uri = FRA[entity_name]
            g.add((cls_uri, RDF.type, OWL.Class))
            desc = self.entity_description(entity_name)
            if desc:
                g.add((cls_uri, RDFS.comment, rdflib.Literal(desc)))

            # Properties from Pydantic fields
            for field_name in model_cls.model_fields:
                prop_uri = FRA[f"{entity_name}.{field_name}"]
                g.add((prop_uri, RDF.type, OWL.DatatypeProperty))
                g.add((prop_uri, RDFS.domain, cls_uri))

            # Relations from YAML
            for rel in self.relations_of(entity_name):
                prop_uri = FRA[f"{entity_name}.{rel['name']}"]
                g.add((prop_uri, RDF.type, OWL.ObjectProperty))
                g.add((prop_uri, RDFS.domain, cls_uri))
                if rel.get("target") and rel["target"] in _ENTITY_REGISTRY:
                    g.add((prop_uri, RDFS.range, FRA[rel["target"]]))

        # Salesperson subClassOf Employee
        g.add((FRA["Salesperson"], RDFS.subClassOf, FRA["Employee"]))

        logger.info("RDF graph built: %d triples", len(g))
        return g

    # ── repr ─────────────────────────────────────────────────────────────────

    def __repr__(self) -> str:
        return (
            f"<Ontology version={self._data.get('ontology_version', '?')} "
            f"entities={list(self._entities_cfg.keys())}>"
        )
