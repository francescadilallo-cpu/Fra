"""
OWL ontology definition for manufacturing order management.
Uses rdflib to build an in-memory RDF/OWL graph that mirrors the ERP schema.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from rdflib import Graph, Namespace, RDF, RDFS, OWL, XSD, Literal, URIRef

# ── Namespaces ─────────────────────────────────────────────────────────────────

MFG = Namespace("http://semanticintelligence.io/mfg#")
BASE = Namespace("http://semanticintelligence.io/data#")

# ── Class URIs ─────────────────────────────────────────────────────────────────

CLASSES: dict[str, URIRef] = {
    "Organization": MFG.Organization,
    "Customer": MFG.Customer,
    "Product": MFG.Product,
    "Quote": MFG.Quote,
    "Order": MFG.Order,
    "QuoteLineItem": MFG.QuoteLineItem,
    "OrderLineItem": MFG.OrderLineItem,
}

# ── Object Property URIs ───────────────────────────────────────────────────────

OBJECT_PROPERTIES: dict[str, tuple[str, URIRef, URIRef]] = {
    # name -> (label, domain, range)
    "hasCustomer": ("hasCustomer", MFG.Quote, MFG.Customer),
    "orderedBy": ("orderedBy", MFG.Order, MFG.Customer),
    "hasQuoteLineItem": ("hasQuoteLineItem", MFG.Quote, MFG.QuoteLineItem),
    "hasOrderLineItem": ("hasOrderLineItem", MFG.Order, MFG.OrderLineItem),
    "hasProduct": ("hasProduct", MFG.QuoteLineItem, MFG.Product),
    "orderHasProduct": ("orderHasProduct", MFG.OrderLineItem, MFG.Product),
    "relatedToQuote": ("relatedToQuote", MFG.Order, MFG.Quote),
}

# Datatype properties per class (label, XSD type)
DATA_PROPERTIES: dict[str, list[tuple[str, Any]]] = {
    "Customer": [
        ("identifier", XSD.integer),
        ("name", XSD.string),
        ("sector", XSD.string),
        ("vatNumber", XSD.string),
        ("creditLimit", XSD.decimal),
    ],
    "Product": [
        ("identifier", XSD.integer),
        ("sku", XSD.string),
        ("name", XSD.string),
        ("category", XSD.string),
        ("unitPrice", XSD.decimal),
        ("unitOfMeasure", XSD.string),
    ],
    "Quote": [
        ("identifier", XSD.integer),
        ("date", XSD.date),
        ("status", XSD.string),
        ("totalValue", XSD.decimal),
        ("validUntil", XSD.date),
        ("createdBy", XSD.string),
    ],
    "QuoteLineItem": [
        ("identifier", XSD.integer),
        ("quantity", XSD.decimal),
        ("unitPrice", XSD.decimal),
        ("discountPct", XSD.decimal),
        ("lineTotal", XSD.decimal),
    ],
    "Order": [
        ("identifier", XSD.integer),
        ("date", XSD.date),
        ("status", XSD.string),
        ("deliveryDate", XSD.date),
        ("totalValue", XSD.decimal),
    ],
    "OrderLineItem": [
        ("identifier", XSD.integer),
        ("quantity", XSD.decimal),
        ("unitPrice", XSD.decimal),
        ("lineTotal", XSD.decimal),
    ],
}

# ── Graph positions for UI (ReactFlow layout) ─────────────────────────────────

NODE_POSITIONS: dict[str, dict[str, float]] = {
    "Organization": {"x": 400, "y": 20},
    "Customer": {"x": 400, "y": 140},
    "Quote": {"x": 100, "y": 300},
    "Order": {"x": 700, "y": 300},
    "QuoteLineItem": {"x": 50, "y": 480},
    "OrderLineItem": {"x": 700, "y": 480},
    "Product": {"x": 400, "y": 480},
}

# Map ontology class → DB table
CLASS_TO_TABLE: dict[str, str] = {
    "Customer": "customers",
    "Product": "products",
    "Quote": "quotes",
    "QuoteLineItem": "quote_lines",
    "Order": "orders",
    "OrderLineItem": "order_lines",
}


class ManufacturingOntology:
    """Manages the in-memory OWL ontology graph and exposes helper methods."""

    def __init__(self) -> None:
        self.g = Graph()
        self.g.bind("mfg", MFG)
        self.g.bind("owl", OWL)
        self.g.bind("rdfs", RDFS)
        self._define_schema()
        self._row_counts: dict[str, int] = {}

    # ── Schema definition ──────────────────────────────────────────────────────

    def _define_schema(self) -> None:
        g = self.g

        # Ontology declaration
        onto_uri = URIRef("http://semanticintelligence.io/mfg")
        g.add((onto_uri, RDF.type, OWL.Ontology))
        g.add(
            (onto_uri, RDFS.label, Literal("Manufacturing Order Management Ontology"))
        )

        # Classes
        for name, uri in CLASSES.items():
            g.add((uri, RDF.type, OWL.Class))
            g.add((uri, RDFS.label, Literal(name)))

        # Customer subClassOf Organization
        g.add((MFG.Customer, RDFS.subClassOf, MFG.Organization))

        # Object properties
        for prop_name, (label, domain, range_) in OBJECT_PROPERTIES.items():
            prop_uri = MFG[prop_name]
            g.add((prop_uri, RDF.type, OWL.ObjectProperty))
            g.add((prop_uri, RDFS.label, Literal(label)))
            g.add((prop_uri, RDFS.domain, domain))
            g.add((prop_uri, RDFS.range, range_))

        # Datatype properties
        for class_name, props in DATA_PROPERTIES.items():
            class_uri = CLASSES[class_name]
            for prop_label, xsd_type in props:
                prop_uri = MFG[f"{class_name[0].lower()}{class_name[1:]}_{prop_label}"]
                g.add((prop_uri, RDF.type, OWL.DatatypeProperty))
                g.add((prop_uri, RDFS.label, Literal(prop_label)))
                g.add((prop_uri, RDFS.domain, class_uri))
                g.add((prop_uri, RDFS.range, xsd_type))

    # ── Populate from DB ───────────────────────────────────────────────────────

    def populate_from_db(self, conn: sqlite3.Connection) -> None:
        """Load all DB rows as RDF triples (instance data)."""
        g = self.g
        counts = {}

        # Customers
        rows = conn.execute("SELECT * FROM customers").fetchall()
        counts["customers"] = len(rows)
        for r in rows:
            uri = BASE[f"customer/{r['id']}"]
            g.add((uri, RDF.type, MFG.Customer))
            g.add(
                (uri, MFG.customer_identifier, Literal(r["id"], datatype=XSD.integer))
            )
            g.add((uri, MFG.customer_name, Literal(r["name"])))
            g.add((uri, MFG.customer_sector, Literal(r["sector"])))
            g.add((uri, MFG.customer_vatNumber, Literal(r["vat_number"])))
            g.add(
                (
                    uri,
                    MFG.customer_creditLimit,
                    Literal(r["credit_limit"], datatype=XSD.decimal),
                )
            )

        # Products
        rows = conn.execute("SELECT * FROM products").fetchall()
        counts["products"] = len(rows)
        for r in rows:
            uri = BASE[f"product/{r['id']}"]
            g.add((uri, RDF.type, MFG.Product))
            g.add((uri, MFG.product_identifier, Literal(r["id"], datatype=XSD.integer)))
            g.add((uri, MFG.product_sku, Literal(r["sku"])))
            g.add((uri, MFG.product_name, Literal(r["name"])))
            g.add((uri, MFG.product_category, Literal(r["category"])))
            g.add(
                (
                    uri,
                    MFG.product_unitPrice,
                    Literal(r["unit_price"], datatype=XSD.decimal),
                )
            )

        # Quotes
        rows = conn.execute("SELECT * FROM quotes").fetchall()
        counts["quotes"] = len(rows)
        for r in rows:
            uri = BASE[f"quote/{r['id']}"]
            g.add((uri, RDF.type, MFG.Quote))
            g.add((uri, MFG.quote_identifier, Literal(r["id"], datatype=XSD.integer)))
            g.add((uri, MFG.quote_date, Literal(r["date"], datatype=XSD.date)))
            g.add((uri, MFG.quote_status, Literal(r["status"])))
            g.add(
                (
                    uri,
                    MFG.quote_totalValue,
                    Literal(r["total_value"], datatype=XSD.decimal),
                )
            )
            g.add((uri, MFG.quote_createdBy, Literal(r["created_by"])))
            g.add((uri, MFG.hasCustomer, BASE[f"customer/{r['customer_id']}"]))

        # Quote lines
        rows = conn.execute("SELECT * FROM quote_lines").fetchall()
        counts["quote_lines"] = len(rows)
        for r in rows:
            uri = BASE[f"quote_line/{r['id']}"]
            g.add((uri, RDF.type, MFG.QuoteLineItem))
            g.add(
                (
                    uri,
                    MFG.quoteLineItem_identifier,
                    Literal(r["id"], datatype=XSD.integer),
                )
            )
            g.add(
                (
                    uri,
                    MFG.quoteLineItem_quantity,
                    Literal(r["quantity"], datatype=XSD.decimal),
                )
            )
            g.add(
                (
                    uri,
                    MFG.quoteLineItem_lineTotal,
                    Literal(r["line_total"], datatype=XSD.decimal),
                )
            )
            g.add((uri, MFG.hasProduct, BASE[f"product/{r['product_id']}"]))
            g.add((BASE[f"quote/{r['quote_id']}"], MFG.hasQuoteLineItem, uri))

        # Orders
        rows = conn.execute("SELECT * FROM orders").fetchall()
        counts["orders"] = len(rows)
        for r in rows:
            uri = BASE[f"order/{r['id']}"]
            g.add((uri, RDF.type, MFG.Order))
            g.add((uri, MFG.order_identifier, Literal(r["id"], datatype=XSD.integer)))
            g.add((uri, MFG.order_date, Literal(r["date"], datatype=XSD.date)))
            g.add((uri, MFG.order_status, Literal(r["status"])))
            g.add(
                (
                    uri,
                    MFG.order_totalValue,
                    Literal(r["total_value"], datatype=XSD.decimal),
                )
            )
            g.add(
                (
                    uri,
                    MFG.order_deliveryDate,
                    Literal(r["delivery_date"], datatype=XSD.date),
                )
            )
            g.add((uri, MFG.orderedBy, BASE[f"customer/{r['customer_id']}"]))
            if r["quote_id"]:
                g.add((uri, MFG.relatedToQuote, BASE[f"quote/{r['quote_id']}"]))

        # Order lines
        rows = conn.execute("SELECT * FROM order_lines").fetchall()
        counts["order_lines"] = len(rows)
        for r in rows:
            uri = BASE[f"order_line/{r['id']}"]
            g.add((uri, RDF.type, MFG.OrderLineItem))
            g.add(
                (
                    uri,
                    MFG.orderLineItem_identifier,
                    Literal(r["id"], datatype=XSD.integer),
                )
            )
            g.add(
                (
                    uri,
                    MFG.orderLineItem_quantity,
                    Literal(r["quantity"], datatype=XSD.decimal),
                )
            )
            g.add(
                (
                    uri,
                    MFG.orderLineItem_lineTotal,
                    Literal(r["line_total"], datatype=XSD.decimal),
                )
            )
            g.add((uri, MFG.orderHasProduct, BASE[f"product/{r['product_id']}"]))
            g.add((BASE[f"order/{r['order_id']}"], MFG.hasOrderLineItem, uri))

        self._row_counts = counts

    # ── Graph data for frontend ────────────────────────────────────────────────

    def get_ontology_graph_data(self) -> dict[str, list[dict]]:
        """Return nodes and edges formatted for ReactFlow."""
        nodes: list[dict] = []
        edges: list[dict] = []

        # Class nodes
        for class_name, uri in CLASSES.items():
            table = CLASS_TO_TABLE.get(class_name)
            row_count = self._row_counts.get(table, 0) if table else 0
            pos = NODE_POSITIONS.get(class_name, {"x": 300, "y": 300})

            # Gather datatype properties for this class
            dprops = [label for label, _ in DATA_PROPERTIES.get(class_name, [])]

            nodes.append(
                {
                    "id": class_name,
                    "type": "ontologyNode",
                    "position": pos,
                    "data": {
                        "label": class_name,
                        "uri": str(uri),
                        "db_table": table,
                        "row_count": row_count,
                        "properties": dprops,
                    },
                }
            )

        # Object property edges
        edge_id = 0
        for prop_name, (label, domain, range_) in OBJECT_PROPERTIES.items():
            # Find source/target class names from URIs
            source = next((k for k, v in CLASSES.items() if v == domain), None)
            target = next((k for k, v in CLASSES.items() if v == range_), None)
            if source and target:
                edges.append(
                    {
                        "id": f"e{edge_id}",
                        "source": source,
                        "target": target,
                        "label": label,
                        "type": "smoothstep",
                        "animated": False,
                        "style": {"stroke": "#14b8a6"},
                        "labelStyle": {"fontSize": 10, "fill": "#94a3b8"},
                        "markerEnd": {"type": "ArrowClosed", "color": "#14b8a6"},
                    }
                )
                edge_id += 1

        return {"nodes": nodes, "edges": edges}


# Singleton instance
_ontology: ManufacturingOntology | None = None


def get_ontology() -> ManufacturingOntology:
    global _ontology
    if _ontology is None:
        _ontology = ManufacturingOntology()
    return _ontology
