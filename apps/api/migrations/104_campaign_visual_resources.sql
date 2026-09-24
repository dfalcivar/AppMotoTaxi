-- Keep legacy bytes readable; all new uploads use durable external file storage.
alter table costa_go_campaign_assets drop constraint costa_go_campaign_assets_kind_check;
alter table costa_go_campaign_assets add constraint costa_go_campaign_assets_kind_check check
  (kind in ('MAIN','DARK','MAIN_LIGHT','THUMBNAIL','THUMBNAIL_LIGHT','THUMBNAIL_DARK',
    'HEADER','HEADER_LIGHT','HEADER_DARK','DECORATION','DECORATION_LIGHT','DECORATION_DARK'));
alter table costa_go_campaign_assets alter column data drop not null;
alter table costa_go_campaign_assets add column storage_key text;
alter table costa_go_campaign_assets add column metadata jsonb not null default '{}'::jsonb;
alter table costa_go_campaign_assets add constraint campaign_asset_storage_check
  check ((data is not null) <> (storage_key is not null));
-- Preserve the old avatar treatment. New campaigns default to EDGES in the API.
update costa_go_campaigns set content=content || jsonb_build_object(
  'headerDecorationMode','AVATAR_ACCENT','useDecorativeAssetForHeader',true,
  'allowLightAssetsInDark',true,'allowMainImageInHome',true)
where not (content ? 'headerDecorationMode');
