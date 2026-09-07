CREATE TABLE am_workspace (
 tenant VARCHAR(80) NOT NULL,
 workspace VARCHAR(80) NOT NULL,
 sequence BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY (tenant,workspace)
);
CREATE TABLE am_document (
 tenant VARCHAR(80) NOT NULL,
 workspace VARCHAR(80) NOT NULL,
 kind VARCHAR(80) NOT NULL,
 id VARCHAR(256) NOT NULL,
 version BIGINT NOT NULL,
 body TEXT NOT NULL,
 updated_ms BIGINT NOT NULL,
 PRIMARY KEY (tenant,workspace,kind,id),
 FOREIGN KEY (tenant,workspace) REFERENCES am_workspace(tenant,workspace)
);
CREATE TABLE am_link (
 tenant VARCHAR(80) NOT NULL,
 workspace VARCHAR(80) NOT NULL,
 relation VARCHAR(40) NOT NULL,
 source VARCHAR(256) NOT NULL,
 target VARCHAR(256) NOT NULL,
 PRIMARY KEY (tenant,workspace,relation,source,target),
 FOREIGN KEY (tenant,workspace) REFERENCES am_workspace(tenant,workspace)
);
CREATE INDEX am_link_reverse ON am_link(tenant,workspace,relation,target,source);
CREATE TABLE am_event (
 tenant VARCHAR(80) NOT NULL,
 workspace VARCHAR(80) NOT NULL,
 sequence BIGINT NOT NULL,
 at_ms BIGINT NOT NULL,
 actor VARCHAR(120) NOT NULL,
 type VARCHAR(80) NOT NULL,
 body TEXT NOT NULL,
 PRIMARY KEY (tenant,workspace,sequence),
 FOREIGN KEY (tenant,workspace) REFERENCES am_workspace(tenant,workspace)
);
