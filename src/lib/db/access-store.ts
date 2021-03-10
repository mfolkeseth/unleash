import { EventEmitter } from 'events';
import Knex from 'knex';
import metricsHelper from '../metrics-helper';
import { DB_TIME } from '../events';

const T = {
    ROLE_USER: 'role_user',
    ROLES: 'roles',
    ROLE_PERMISSION: 'role_permission',
};

export interface Permission {
    project?: string;
    permission: string;
}

export interface Role {
    id: number;
    name: string;
    description?: string;
    type: string;
    project?: string;
}

export class AccessStore {
    private logger: Function;

    private timer: Function;

    private db: Knex;

    constructor(db: Knex, eventBus: EventEmitter, getLogger: Function) {
        this.db = db;
        this.logger = getLogger('access-store.js');
        this.timer = (action: string) =>
            metricsHelper.wrapTimer(eventBus, DB_TIME, {
                store: 'access-store',
                action,
            });
    }

    async getPermissionsForUser(userId: Number): Promise<Permission[]> {
        const stopTimer = this.timer('getPermissionsForUser');
        const rows = await this.db
            .select('project', 'permission')
            .from<Permission>(`${T.ROLE_PERMISSION} AS rp`)
            .leftJoin(`${T.ROLE_USER} AS ur`, 'ur.role_id', 'rp.role_id')
            .where('user_id', '=', userId);
        stopTimer();
        return rows;
    }

    async getPermissionsForRole(roleId: number): Promise<Permission[]> {
        const stopTimer = this.timer('getPermissionsForRole');
        const rows = await this.db
            .select('project', 'permission')
            .from<Permission>(`${T.ROLE_PERMISSION}`)
            .where('role_id', '=', roleId);
        stopTimer();
        return rows;
    }

    async getRoles(): Promise<Role[]> {
        return this.db
            .select(['id', 'name', 'type', 'description'])
            .from<Role>(T.ROLES);
    }

    async getRoleWithId(id: number): Promise<Role> {
        return this.db
            .select(['id', 'name', 'type', 'description'])
            .where('id', id)
            .first()
            .from<Role>(T.ROLES);
    }

    async getRolesForProject(projectName: string): Promise<Role[]> {
        return this.db
            .select(['id', 'name', 'type', 'project', 'description'])
            .from<Role>(T.ROLES)
            .where('project', projectName);
    }

    async removeRolesForProject(projectId: string): Promise<void> {
        return this.db(T.ROLES)
            .where({
                project: projectId,
            })
            .delete();
    }

    async getRolesForUserId(userId: number): Promise<Role[]> {
        return this.db
            .select(['id', 'name', 'type', 'project', 'description'])
            .from<Role[]>(T.ROLES)
            .innerJoin(`${T.ROLE_USER} as ru`, 'ru.role_id', 'id')
            .where('ru.user_id', '=', userId);
    }

    async getUserIdsForRole(roleId: number): Promise<Role[]> {
        const rows = await this.db
            .select(['user_id'])
            .from<Role>(T.ROLE_USER)
            .where('role_id', roleId);
        return rows.map(r => r.user_id);
    }

    async addUserToRole(userId: number, roleId: number): Promise<void> {
        return this.db(T.ROLE_USER).insert({
            user_id: userId,
            role_id: roleId,
        });
    }

    async removeUserFromRole(userId: number, roleId: number): Promise<void> {
        return this.db(T.ROLE_USER)
            .where({
                user_id: userId,
                role_id: roleId,
            })
            .delete();
    }

    async createRole(
        name: string,
        type: string,
        project?: string,
        description?: string,
    ): Promise<Role> {
        const [id] = await this.db(T.ROLES)
            .insert({ name, description, type, project })
            .returning('id');
        return { id, name, description, type, project };
    }

    async addPermissionsToRole(
        role_id: number,
        permissions: string[],
        projectName?: string,
    ): Promise<void> {
        const rows = permissions.map(permission => ({
            role_id,
            project: projectName,
            permission,
        }));
        return this.db.batchInsert(T.ROLE_PERMISSION, rows);
    }

    async removePermissionFromRole(
        roleId: number,
        permission: string,
        projectName?: string,
    ): Promise<void> {
        return this.db(T.ROLE_PERMISSION)
            .where({
                role_id: roleId,
                permission,
                project: projectName,
            })
            .delete();
    }
}