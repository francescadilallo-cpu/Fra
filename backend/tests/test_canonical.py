"""Canonical entity naming: display names + cross-source concept grouping."""

from app.semantic.canonical import canonical_concept, concept_aliases, display_name


class TestDisplayName:
    def test_salesforce_table_prettified(self):
        assert display_name("sf_salesforce_6650fdb1_account") == "Account"

    def test_connector_label_wins(self):
        assert display_name("sf_salesforce_6650fdb1_account", "Cliente") == "Cliente"

    def test_source_prefix_stripped(self):
        assert display_name("crm_accounts") == "Account"
        assert display_name("legacy_customers") == "Customer"

    def test_multiword_table(self):
        assert display_name("sales_order_header") == "Sales Order Header"

    def test_plural_last_token_singularised(self):
        assert display_name("sales_orders") == "Sales Order"
        assert display_name("opportunities") == "Opportunity"

    def test_no_business_tokens_falls_back(self):
        # Nothing but source junk — return something, never crash.
        assert display_name("sf_123") != ""


class TestCanonicalConcept:
    def test_equivalent_tables_group_under_one_concept(self):
        assert canonical_concept("sf_salesforce_6650fdb1_account") == "Customer"
        assert canonical_concept("crm_accounts") == "Customer"
        assert canonical_concept("legacy_customers") == "Customer"
        assert canonical_concept("clienti") == "Customer"

    def test_label_beats_table_name(self):
        # Table name is opaque, but the connector label says what it is —
        # accents fold so the Italian SF label still matches.
        assert canonical_concept("tbl_xyz", "Opportunità") == "Opportunity"
        assert canonical_concept("tbl_xyz", "Deals") == "Opportunity"

    def test_products_and_orders(self):
        assert canonical_concept("pim_products") == "Product"
        assert canonical_concept("sf_salesforce_6650fdb1_product2") == "Product"
        assert canonical_concept("sales_order_header") == "Order"

    def test_unknown_gets_no_concept(self):
        assert canonical_concept("warehouse_zones") is None
        assert canonical_concept("random_table") is None

    def test_aliases_exported_for_nl_linking(self):
        aliases = concept_aliases("Customer")
        assert "clienti" in aliases and "accounts" in aliases
        assert concept_aliases("Nonexistent") == frozenset()


class TestConceptsYaml:
    def test_shipped_dictionary_loads(self):
        from app.semantic.canonical import _load_concept_aliases

        concepts = _load_concept_aliases()
        assert len(concepts) >= 16
        assert "cliente" in concepts["Customer"]

    def test_path_override_and_broken_file_degrade_gracefully(
        self, tmp_path, monkeypatch
    ):
        from app.semantic.canonical import _load_concept_aliases

        custom = tmp_path / "concepts.yaml"
        custom.write_text(
            "concepts:\n  Patient:\n    - paziente\n    - Pazienti\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("FRA_CONCEPTS_PATH", str(custom))
        concepts = _load_concept_aliases()
        # Aliases are accent-folded and lowercased at load time.
        assert concepts == {"Patient": frozenset({"paziente", "pazienti"})}

        custom.write_text("not: a\nvalid: dictionary\n", encoding="utf-8")
        assert _load_concept_aliases() == {}  # error logged, boot survives
